import type { Judgement } from "../game/judge";

/**
 * One-shot hit feedback, synthesized — no samples to load. Hi-hat style:
 * every sound is a burst of high-passed white noise, which reads as
 * percussion and sits naturally on top of any song. Everything is
 * deliberately quiet and short: the effects confirm "you hit that beat"
 * under the song, they never compete with it.
 *
 * Plays through the AudioClock's context (same unlock, same clock); the
 * clock's destroy() closes the context and takes these with it.
 */

/** Highpass cutoff per tier — the cleaner the hit, the brighter the hat. */
const HIT_CUTOFF: Readonly<Record<Exclude<Judgement, "miss">, number>> = {
  good: 6000,
  great: 8000,
  perfect: 10000,
};

const HIT_PEAK: Readonly<Record<Exclude<Judgement, "miss">, number>> = {
  good: 0.07,
  great: 0.09,
  perfect: 0.11,
};

/** A closed hat is a tick; an open hat rings ~4x longer. */
const CLOSED_DECAY_S = 0.06;
const OPEN_DECAY_S = 0.28;

export class Sfx {
  private readonly master: GainNode;
  /** One second of white noise, generated once and reused by every burst. */
  private readonly noise: AudioBuffer;

  constructor(private readonly ctx: AudioContext) {
    this.master = ctx.createGain();
    this.master.gain.value = 1;
    this.master.connect(ctx.destination);

    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }

  /**
   * One enveloped noise burst through a highpass: silent-attack in,
   * exponential decay out. Exponential ramps can't reach zero, so the
   * envelope lives between 0.0001 and the peak — inaudible at both ends,
   * no clicks. A random buffer offset keeps rapid hits from sounding like
   * the same sample retriggered.
   */
  private hat(cutoff: number, peak: number, decayS: number, atS = 0): void {
    const t = this.ctx.currentTime + atS;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const offset = Math.random() * (this.noise.duration - decayS - 0.05);

    const filter = this.ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = cutoff;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + decayS);

    src.connect(filter).connect(gain).connect(this.master);
    src.start(t, offset);
    src.stop(t + decayS + 0.02);
  }

  /** Tap connected: a closed hat, brighter the cleaner the hit. */
  hit(judgement: Exclude<Judgement, "miss">): void {
    this.hat(HIT_CUTOFF[judgement], HIT_PEAK[judgement], CLOSED_DECAY_S);
  }

  /**
   * Hold head caught: the closed hat plus a darker foot-pedal "chick"
   * underneath — the "latched on" feel while the bar starts being consumed.
   */
  holdStart(judgement: Exclude<Judgement, "miss">): void {
    this.hit(judgement);
    this.hat(3000, 0.05, 0.09);
  }

  /**
   * Hold ridden to its end (or released in grace): an open hat — the same
   * voice as the taps, left to ring as the reward.
   */
  holdRelease(): void {
    this.hat(8000, 0.08, OPEN_DECAY_S);
  }
}
