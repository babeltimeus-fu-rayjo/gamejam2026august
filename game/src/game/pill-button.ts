import { Container, Graphics, Rectangle, Text } from "pixi.js";
import { drawAccentRing, drawPanel } from "./panel";

export interface PillOptions {
  label: string;
  onTap: () => void;
  /** Accent ring colour on hover. */
  color?: number;
  minWidth?: number;
  /** 40px keeps the pill a comfortable touch target at 1x scale. */
  height?: number;
  fontSize?: number;
}

export interface Pill {
  readonly view: Container;
  setLabel(label: string): void;
  setEnabled(enabled: boolean): void;
}

/**
 * Compact tappable pill in the shared panel style — the pointer counterpart
 * to the lobby's key bindings (CREATE/JOIN/READY/…) and the code pad's keys.
 * NeonButton stays the big title-screen variant; this is the row-sized one.
 */
export function makePill(opts: PillOptions): Pill {
  const height = opts.height ?? 40;
  const fontSize = opts.fontSize ?? 18;
  const color = opts.color ?? 0x6f5cc8;

  const view = new Container();
  const bg = new Graphics();
  const ring = new Graphics();
  ring.visible = false;
  const text = new Text({
    text: opts.label,
    style: {
      fontFamily: "Arial",
      fontSize,
      fontWeight: "700",
      letterSpacing: 1,
      fill: 0xcfc4f2,
    },
  });
  text.anchor.set(0.5);
  view.addChild(bg, ring, text);

  let enabled = true;
  let width = 0;

  const layout = (): void => {
    width = Math.max(opts.minWidth ?? 64, text.width + 28);
    drawPanel(bg, width, height);
    drawAccentRing(ring, width, height, color);
    text.position.set(width / 2, height / 2);
    view.hitArea = new Rectangle(0, 0, width, height);
  };
  layout();

  view.eventMode = "static";
  view.cursor = "pointer";
  view.on("pointerover", () => {
    if (enabled) ring.visible = true;
  });
  view.on("pointerout", () => {
    ring.visible = false;
  });
  view.on("pointertap", () => {
    if (enabled) opts.onTap();
  });

  return {
    view,
    setLabel(label: string): void {
      if (text.text === label) return;
      text.text = label;
      layout();
    },
    setEnabled(next: boolean): void {
      enabled = next;
      view.cursor = next ? "pointer" : "default";
      view.alpha = next ? 1 : 0.4;
      if (!next) ring.visible = false;
    },
  };
}
