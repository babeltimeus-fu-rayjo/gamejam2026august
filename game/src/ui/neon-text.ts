import { Text, TextStyle } from "pixi.js";

/**
 * The game's one text look: a white-hot core, a coloured rim and a coloured
 * glow halo, exactly as the HUD wears it. Shared so the HUD, the results screen
 * and anything else that has to look like it belongs on the same track can't
 * drift apart.
 *
 * Regular Text (not BitmapText): the glow needs canvas effects, and these are
 * short strings that re-render only when they change.
 */
export function neonStyle(
  glow: number,
  overrides: ConstructorParameters<typeof TextStyle>[0] = {},
): TextStyle {
  return new TextStyle({
    fontFamily: "Arial",
    fontWeight: "900",
    fill: 0xffffff,
    stroke: { color: glow, width: 3 },
    dropShadow: { color: glow, blur: 14, distance: 0, angle: 0, alpha: 0.9 },
    ...overrides,
  });
}

/** Centred neon label — the common case. */
export function neonText(
  text: string,
  x: number,
  y: number,
  style: TextStyle,
): Text {
  const t = new Text({ text, style });
  t.anchor.set(0.5);
  t.position.set(x, y);
  return t;
}
