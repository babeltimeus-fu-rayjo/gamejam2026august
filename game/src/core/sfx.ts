import type { Judgement } from "../game/judge";

/**
 * One-shot hit feedback, synthesized — no samples to load. Hi-hat style:
 * every sound is a burst of high-passed white noise, which reads as
 * percussion and sits naturally on top of any song. Everything is short,
 * but not quiet: the effects have to read as *your* hit over a full-scale
 * song, so they sit on top of the mix rather than under it.
 *
 * Plays through the AudioClock's context (same unlock, same clock); the
 * clock's destroy() closes the context and takes these with it.
 */

/**
 * Highpass cutoff per tier — the cleaner the hit, the brighter the hat.
 * Kept below ~7 kHz: the song is loud and full-scale, and a burst living
 * only in the top octave disappears into it however loud we make it.
 */
const HIT_CUTOFF: Readonly<Record<Exclude<Judgement, "miss">, number>> = {
  good: 3500,
  great: 5000,
  perfect: 6500,
};

/**
 * Peak gain per tier. The song runs straight to the destination at full
 * scale, so these have to be a real fraction of it to be audible at all —
 * anything at 0.1 is buried.
 */
const HIT_PEAK: Readonly<Record<Exclude<Judgement, "miss">, number>> = {
  good: 0.3,
  great: 0.38,
  perfect: 0.45,
};

/** A closed hat is a tick; an open hat rings ~4x longer. */
const CLOSED_DECAY_S = 0.07;
const OPEN_DECAY_S = 0.3;

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
    this.hat(1200, 0.28, 0.11);
  }

  /**
   * Hold ridden to its end (or released in grace): an open hat — the same
   * voice as the taps, left to ring as the reward.
   */
  holdRelease(): void {
    this.hat(5000, 0.36, OPEN_DECAY_S);
  }
}
