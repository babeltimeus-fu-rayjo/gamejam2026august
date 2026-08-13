import { Graphics } from "pixi.js";

/**
 * The menus' one panel look: a translucent slab with a thin violet edge, dark
 * enough to carry text but open enough that the background video moves through
 * it. Shared by the lobby's rows and the title's mode buttons so the two screens
 * can't drift apart.
 */
export const PANEL_RADIUS = 10;
const FILL = 0x1d1630;
const FILL_ALPHA = 0.82;
const EDGE = 0x6f5cc8;

/** Draw the panel into `g`, replacing whatever was there. */
export function drawPanel(g: Graphics, width: number, height: number): void {
  g.clear()
    .roundRect(0, 0, width, height, PANEL_RADIUS)
    .fill({ color: FILL, alpha: FILL_ALPHA })
    .stroke({ color: EDGE, width: 1, alpha: 0.5 });
}

/**
 * The accent ring that marks a panel as live — hovered in the lobby, selected on
 * the title. Inset by half a pixel so the 2px stroke lands inside the panel
 * instead of straddling its edge.
 */
export function drawAccentRing(
  g: Graphics,
  width: number,
  height: number,
  color: number,
  alpha = 0.9,
): void {
  g.clear()
    .roundRect(0.5, 0.5, width - 1, height - 1, PANEL_RADIUS)
    .stroke({ color, width: 2, alpha });
}
