import { Container, FillGradient, Graphics, Text } from "pixi.js";
import { VIRTUAL_HEIGHT, VIRTUAL_WIDTH } from "../config";

// Song progress bar pinned along the bottom edge of the gameplay screen:
// elapsed time at the left end, total length at the right, and between
// them a slim purple gauge that fills as the song plays, capped with a
// glowing playhead. Styled after the HUD's life bar (dark rounded back,
// neon fill) so the two gauges read as one family.

const BAR_PURPLE = 0xb87ae0;
const BAR_PURPLE_DIM = 0x9678c8;
/** Fill gradient endpoints as rgb components for FillGradient's rgba(). */
const FILL_FROM_RGB = "150, 120, 200";
const FILL_TO_RGB = "184, 122, 224";

/** Hex color → "r, g, b" for the rgba() gradient strings. */
function rgbOf(color: number): string {
  return `${(color >> 16) & 0xff}, ${(color >> 8) & 0xff}, ${color & 0xff}`;
}

const BAR_H = 8;
/** Vertical center; hugs the bottom edge, under the status line. */
const BAR_CENTER_Y = VIRTUAL_HEIGHT - 14;
/** Horizontal span, leaving room for the m:ss readouts at each end. */
const BAR_X = 84;
const BAR_W = VIRTUAL_WIDTH - 2 * BAR_X;
const TIME_GAP = 12;

const FILL_INSET = 2;
const CAP_RADIUS = 4;
const CAP_GLOW_RADIUS = 8;

/** Seconds → m:ss for the readouts (floored, clamped at zero). */
function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Bottom-edge song progress gauge. Gameplay sets the duration once the
 * chart arrives and feeds songTime() every frame; the bar stays hidden
 * until it knows how long the song is.
 */
export class SongProgressBar {
  readonly view = new Container();

  private readonly fill: Graphics;
  private readonly elapsedText: Text;
  private readonly totalText: Text;
  // Fill/cap colors, resolved once: the character's accent when given,
  // otherwise the default purples. The back panel stays neutral chrome.
  private readonly capColor: number;
  private readonly fromRgb: string;
  private readonly toRgb: string;
  private durationS = 0;
  /** Last drawn fill width in whole px; redraw only when it moves. */
  private lastFillW = -1;
  /** Last rendered elapsed second; the Text re-renders only on change. */
  private lastElapsedS = -1;

  constructor(accent?: number) {
    this.capColor = accent ?? BAR_PURPLE;
    this.fromRgb = accent === undefined ? FILL_FROM_RGB : rgbOf(accent);
    this.toRgb = accent === undefined ? FILL_TO_RGB : rgbOf(accent);
    const timeStyle = {
      fontFamily: "Arial",
      fontSize: 16,
      fontWeight: "700",
      letterSpacing: 1,
      fill: 0x9f8fd8,
    } as const;

    this.elapsedText = new Text({ text: "0:00", style: timeStyle });
    this.elapsedText.anchor.set(1, 0.5);
    this.elapsedText.position.set(BAR_X - TIME_GAP, BAR_CENTER_Y);

    this.totalText = new Text({ text: "0:00", style: timeStyle });
    this.totalText.anchor.set(0, 0.5);
    this.totalText.position.set(BAR_X + BAR_W + TIME_GAP, BAR_CENTER_Y);

    const back = new Graphics()
      .roundRect(BAR_X, BAR_CENTER_Y - BAR_H / 2, BAR_W, BAR_H, BAR_H / 2)
      .fill({ color: 0x1d1630, alpha: 0.85 })
      .stroke({ width: 1.5, color: BAR_PURPLE_DIM, alpha: 0.5 });

    this.fill = new Graphics();

    this.view.addChild(back, this.fill, this.elapsedText, this.totalText);
    this.view.visible = false;
  }

  /** Chart's song.duration; reveals the bar and pins the right readout. */
  setDuration(seconds: number): void {
    this.durationS = seconds;
    this.totalText.text = formatTime(seconds);
    this.view.visible = true;
  }

  /** Feed songTime() (negative during lead-in; clamped both ends). */
  update(songTimeS: number): void {
    if (this.durationS <= 0) return;
    const t = Math.min(Math.max(0, songTimeS), this.durationS);

    const elapsedS = Math.floor(t);
    if (elapsedS !== this.lastElapsedS) {
      this.lastElapsedS = elapsedS;
      this.elapsedText.text = formatTime(t);
    }

    // Quantized to whole px so the Graphics only rebuilds when it moves.
    const w = Math.round((BAR_W - 2 * FILL_INSET) * (t / this.durationS));
    if (w === this.lastFillW) return;
    this.lastFillW = w;
    this.redrawFill(w);
  }

  private redrawFill(w: number): void {
    this.fill.clear();
    const capX = BAR_X + FILL_INSET + w;
    const fillH = BAR_H - 2 * FILL_INSET;
    if (w >= fillH) {
      // Dim at the start, brightening toward the playhead, so the lit
      // portion reads as "where the song is" rather than a static stripe.
      const gradient = new FillGradient({
        start: { x: 0, y: 0 },
        end: { x: 1, y: 0 },
        colorStops: [
          { offset: 0, color: `rgba(${this.fromRgb}, 0.7)` },
          { offset: 1, color: `rgba(${this.toRgb}, 1)` },
        ],
      });
      this.fill
        .roundRect(
          BAR_X + FILL_INSET,
          BAR_CENTER_Y - fillH / 2,
          w,
          fillH,
          fillH / 2,
        )
        .fill(gradient);
    }
    // Glowing playhead cap: soft halo under a white-hot core, the same
    // white-core-plus-colored-glow recipe the neon text uses.
    this.fill
      .circle(capX, BAR_CENTER_Y, CAP_GLOW_RADIUS)
      .fill({ color: this.capColor, alpha: 0.35 })
      .circle(capX, BAR_CENTER_Y, CAP_RADIUS + 1.5)
      .fill({ color: this.capColor, alpha: 0.9 })
      .circle(capX, BAR_CENTER_Y, CAP_RADIUS - 1)
      .fill(0xffffff);
  }
}
