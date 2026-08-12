import { Container, Graphics, Text } from "pixi.js";

export interface NeonButtonOptions {
  label: string;
  /** Caption under the label. */
  sub?: string;
  width: number;
  height: number;
  /** Outline and glow colour. */
  color: number;
  onActivate: () => void;
}

/**
 * Neon-outlined menu button.
 *
 * Pointer and keyboard drive the same `selected` state, so hovering with the
 * mouse and arrowing across with the keyboard can't disagree about which button
 * is live. The glow breathes on the selected one and pulses harder on a beat.
 */
export class NeonButton extends Container {
  private readonly frame = new Graphics();
  private readonly glow = new Graphics();
  private readonly w: number;
  private readonly h: number;
  private readonly color: number;

  private selectedState = false;
  private elapsed = 0;

  constructor({
    label,
    sub,
    width,
    height,
    color,
    onActivate,
  }: NeonButtonOptions) {
    super();
    this.w = width;
    this.h = height;
    this.color = color;

    this.addChild(this.glow, this.frame);

    const text = new Text({
      text: label,
      style: {
        fontFamily: "Arial",
        fontSize: 40,
        fontWeight: "900",
        letterSpacing: 6,
        fill: 0xffffff,
      },
    });
    text.anchor.set(0.5);
    text.position.set(width / 2, sub ? height / 2 - 10 : height / 2);
    this.addChild(text);

    if (sub) {
      const caption = new Text({
        text: sub,
        style: {
          fontFamily: "Arial",
          fontSize: 16,
          letterSpacing: 3,
          fill: color,
        },
      });
      caption.anchor.set(0.5);
      caption.position.set(width / 2, height / 2 + 24);
      caption.alpha = 0.85;
      this.addChild(caption);
    }

    this.eventMode = "static";
    this.cursor = "pointer";
    this.on("pointerover", () => (this.selected = true));
    // pointertap only: binding pointerdown as well fires the callback twice.
    this.on("pointertap", onActivate);

    this.redraw(0);
  }

  get selected(): boolean {
    return this.selectedState;
  }

  set selected(value: boolean) {
    this.selectedState = value;
  }

  /** @param kick 0..1 beat spike, brightens the glow in time with the music. */
  update(dt: number, kick = 0): void {
    this.elapsed += dt;
    const breathe = this.selectedState
      ? 0.7 + 0.3 * Math.sin(this.elapsed * 3.4)
      : 0.22;
    this.redraw(Math.min(1, breathe + kick * (this.selectedState ? 0.5 : 0.2)));
  }

  private redraw(intensity: number): void {
    const r = 14;

    this.glow.clear();
    // Three concentric strokes fake a bloom without pulling in a blur filter.
    for (let i = 3; i >= 1; i--) {
      this.glow
        .roundRect(-i * 4, -i * 4, this.w + i * 8, this.h + i * 8, r + i * 4)
        .stroke({
          color: this.color,
          width: 2 + i,
          alpha: (intensity * 0.16) / i,
        });
    }

    this.frame
      .clear()
      .roundRect(0, 0, this.w, this.h, r)
      .fill({ color: 0x000000, alpha: 0.45 + intensity * 0.1 })
      .stroke({
        color: this.color,
        width: 2.5,
        alpha: 0.55 + intensity * 0.45,
      });

    this.scale.set(1 + intensity * 0.02);
    this.pivot.set(this.w * intensity * 0.01, this.h * intensity * 0.01);
  }
}
