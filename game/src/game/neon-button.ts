import { Container, Graphics, Text } from "pixi.js";
import { drawAccentRing, drawPanel } from "./panel";

export interface NeonButtonOptions {
  label: string;
  /** Caption under the label. */
  sub?: string;
  width: number;
  height: number;
  /** Accent colour: the caption, and the ring shown when selected. */
  color: number;
  onActivate: () => void;
  /**
   * Hover. Owners that track focus across a row of buttons should move their
   * focus here rather than let the button select itself, or the hovered button
   * and the keyboard-focused one both end up wearing the ring.
   */
  onFocus?: () => void;
}

/**
 * Menu button wearing the lobby's panel style: same translucent slab and violet
 * edge as the lobby rows, with the accent ring marking the live one.
 *
 * Pointer and keyboard drive the same `selected` state, so hovering with the
 * mouse and arrowing across with the keyboard can't disagree about which button
 * is live. The ring brightens on a beat — the only thing left reacting to the
 * music now that the background is a video.
 */
export class NeonButton extends Container {
  private readonly panel = new Graphics();
  private readonly ring = new Graphics();
  private readonly w: number;
  private readonly h: number;
  private readonly color: number;

  private selectedState = false;

  constructor({
    label,
    sub,
    width,
    height,
    color,
    onActivate,
    onFocus,
  }: NeonButtonOptions) {
    super();
    this.w = width;
    this.h = height;
    this.color = color;

    drawPanel(this.panel, width, height);
    this.addChild(this.panel, this.ring);

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
    this.on("pointerover", () =>
      onFocus ? onFocus() : (this.selected = true),
    );
    // pointertap only: binding pointerdown as well fires the callback twice.
    this.on("pointertap", onActivate);

    this.update(0);
  }

  get selected(): boolean {
    return this.selectedState;
  }

  set selected(value: boolean) {
    this.selectedState = value;
  }

  /** @param kick 0..1 beat spike, brightens the ring in time with the music. */
  update(_dt: number, kick = 0): void {
    this.ring.visible = this.selectedState;
    if (!this.selectedState) return;
    drawAccentRing(this.ring, this.w, this.h, this.color, 0.75 + kick * 0.25);
  }
}
