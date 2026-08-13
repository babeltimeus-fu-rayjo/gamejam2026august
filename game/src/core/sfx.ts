import type { Judgement } from "../game/judge";

/**
 * One-shot hit feedback, synthesized — no samples to load, and a few
 * oscillator nodes per second is nothing. Everything is deliberately quiet
 * and short: the effects confirm "you hit that beat" under the song, they
 * never compete with it.
 *
 * Plays through the AudioClock's context (same unlock, same clock); the
 * clock's destroy() closes the context and takes these with it.
 */

/** Blip pitch per tier — brighter the cleaner the hit (C6 / E6 / G6). */
const HIT_FREQ: Readonly<Record<Exclude<Judgement, "miss">, number>> = {
  good: 1046,
  great: 1318,
  perfect: 1568,
};

const HIT_PEAK: Readonly<Record<Exclude<Judgement, "miss">, number>> = {
  good: 0.07,
  great: 0.09,
  perfect: 0.11,
};

export class Sfx {
  private readonly master: GainNode;

  constructor(private readonly ctx: AudioContext) {
    this.master = ctx.createGain();
    this.master.gain.value = 1;
    this.master.connect(ctx.destination);
  }

  /**
   * One enveloped oscillator: silent-attack in, exponential decay out.
   * Exponential ramps can't reach zero, so the envelope lives between
   * 0.0001 and the peak — inaudible at both ends, no clicks.
   */
  private blip(
    freq: number,
    peak: number,
    decayS: number,
    type: OscillatorType = "triangle",
    glideTo?: number,
  ): void {
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (glideTo !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(glideTo, t + decayS);
    }
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + decayS);
    osc.connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + decayS + 0.02);
  }

  /** Tap connected: a short tick, pitched by how clean the hit was. */
  hit(judgement: Exclude<Judgement, "miss">): void {
    this.blip(HIT_FREQ[judgement], HIT_PEAK[judgement], 0.09);
  }

  /**
   * Hold head caught: the hit tick plus a soft upward glide underneath —
   * the "latched on" feel while the bar starts being consumed.
   */
  holdStart(judgement: Exclude<Judgement, "miss">): void {
    this.hit(judgement);
    this.blip(392, 0.05, 0.16, "sine", 523);
  }

  /** Hold ridden to its end (or released in grace): a gentle rising chime. */
  holdRelease(): void {
    this.blip(1046, 0.07, 0.14, "sine");
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 1568;
    gain.gain.setValueAtTime(0.0001, t + 0.07);
    gain.gain.exponentialRampToValueAtTime(0.09, t + 0.075);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    osc.connect(gain).connect(this.master);
    osc.start(t + 0.07);
    osc.stop(t + 0.27);
  }
}
