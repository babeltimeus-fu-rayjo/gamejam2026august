import type { Text } from "pixi.js";

/**
 * A readout that counts up to its value like a timer instead of appearing
 * finished. Owns nothing but the Text it was handed, so the caller keeps
 * control of layout and styling.
 */
export class NumberRoll {
  private shown = 0;
  private from = 0;
  private to = 0;
  private ageMs = 0;
  private durationMs = 0;

  constructor(
    private readonly text: Text,
    /** Turns the running value into what the player reads. */
    private readonly format: (value: number) => string,
    /**
     * Widest the readout may render, in the text's own coordinates. Scores and
     * combos are unbounded but the panel behind them is not, so a long figure
     * is scaled down rather than allowed past its slab. Omit for no limit.
     */
    private readonly maxWidth?: number,
  ) {}

  /** Count from whatever is on screen now up to `value`. */
  rollTo(value: number, durationMs: number): void {
    this.from = this.shown;
    this.to = value;
    this.ageMs = 0;
    this.durationMs = Math.max(1, durationMs);
  }

  /** Jump straight to `value` — for numbers that arrive already settled. */
  snapTo(value: number): void {
    this.from = value;
    this.to = value;
    this.shown = value;
    this.ageMs = 0;
    this.durationMs = 0;
    this.write(value);
  }

  get done(): boolean {
    return this.ageMs >= this.durationMs;
  }

  update(deltaMs: number): void {
    if (this.done) return;
    this.ageMs = Math.min(this.durationMs, this.ageMs + deltaMs);
    const t = this.ageMs / this.durationMs;
    // Ease-out: the count sprints away and brakes onto the figure. A linear
    // ramp reads as a progress bar; this reads as a counter coming to rest.
    this.shown = this.from + (this.to - this.from) * (1 - (1 - t) ** 2);
    // Land exactly on the value — interpolation alone leaves rounding dust.
    if (this.done) this.shown = this.to;
    this.write(this.shown);
  }

  private write(value: number): void {
    const next = this.format(value);
    if (this.text.text === next) return;
    this.text.text = next;
    if (this.maxWidth === undefined) return;
    // Measure unscaled, then shrink to fit: scaling the rendered text beats
    // wrapping, since a stat line only reads as one line.
    this.text.scale.set(1);
    if (this.text.width > this.maxWidth) {
      this.text.scale.set(this.maxWidth / this.text.width);
    }
  }
}
