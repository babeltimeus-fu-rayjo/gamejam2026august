import {
  Container,
  FillGradient,
  Graphics,
  Text,
  TextStyle,
  Ticker,
} from "pixi.js";
import { VIRTUAL_HEIGHT, VIRTUAL_WIDTH } from "../config";
import type { Emitter } from "../core/events";
import type { Judgement } from "../game/judge";
import type { GameEvents } from "../game/score";

// Regular Text (not BitmapText): the neon look needs canvas effects —
// white core, colored stroke, zero-distance blurred dropShadow as the
// glow halo. These are short strings that re-render only on change.
const JUDGEMENT_GLOW: Readonly<Record<Judgement, number>> = {
  perfect: 0xffd75c,
  great: 0x5cd7ff,
  good: 0x9f8fd8,
  miss: 0xff5c5c,
};

// Top display tier above PERFECT: while a streak of 10+ combo holds,
// every hit reads EXTRAORDINARY (the song's namesake); a miss resets
// the combo to 0, so the tier must be re-earned. Pure presentation —
// judgement windows and scoring are unchanged.
const EXTRAORDINARY_COMBO = 10;
const EXTRAORDINARY_GLOW = 0xffc94d;

/** Neon text: white-hot core, colored rim, colored glow halo. */
function neonStyle(
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

// One prebuilt style per popup tier; swapping styles re-renders the text.
const POPUP_STYLES: Readonly<Record<Judgement | "extraordinary", TextStyle>> = {
  perfect: neonStyle(JUDGEMENT_GLOW.perfect, { fontSize: 52 }),
  great: neonStyle(JUDGEMENT_GLOW.great, { fontSize: 52 }),
  good: neonStyle(JUDGEMENT_GLOW.good, { fontSize: 52 }),
  miss: neonStyle(JUDGEMENT_GLOW.miss, { fontSize: 52 }),
  extraordinary: neonStyle(EXTRAORDINARY_GLOW, {
    fontSize: 52,
    dropShadow: {
      color: EXTRAORDINARY_GLOW,
      blur: 22,
      distance: 0,
      angle: 0,
      alpha: 1,
    },
  }),
};

const POPUP_HOLD_MS = 250;
const POPUP_FADE_MS = 350;
const POPUP_POP_SCALE = 1.25;
const EXTRAORDINARY_POP_SCALE = 1.5;

// While the EXTRAORDINARY streak is alive, the screen frame throbs with
// green light (edge vignette). A miss kills it immediately; it must be
// re-earned with the combo.
const VIGNETTE_DEPTH = 140;
const VIGNETTE_RGB = "140, 220, 150";
const VIGNETTE_ATTACK_MS = 120;
const VIGNETTE_RELEASE_MS = 150;
const VIGNETTE_BASE_ALPHA = 0.4;
const VIGNETTE_PULSE_ALPHA = 0.25;
const VIGNETTE_PULSE_HZ = 2.2;

/** Gradient strip fading from the screen edge inward. */
function edgeStrip(
  x: number,
  y: number,
  w: number,
  h: number,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Graphics {
  const gradient = new FillGradient({
    start: from,
    end: to,
    colorStops: [
      { offset: 0, color: `rgba(${VIGNETTE_RGB}, 0.55)` },
      { offset: 1, color: `rgba(${VIGNETTE_RGB}, 0)` },
    ],
  });
  return new Graphics().rect(x, y, w, h).fill(gradient);
}

// Readout column at the track's upper middle, where the eye rests
// between notes: judgement popup on top, the combo count (big, thin
// digits) beneath it, and the word COMBO under the count.
const POPUP_Y = 220;
const COMBO_NUMBER_Y = 300;
const COMBO_LABEL_Y = 380;

/** Score / combo readouts + judgement popup, driven by the gameplay bus. */
export class Hud {
  readonly view = new Container();

  private readonly scoreText: Text;
  private readonly comboText: Text;
  private readonly comboLabel: Text;
  private readonly popup: Text;
  private readonly vignette: Container;
  private popupAgeMs = Infinity;
  private popupPopScale = POPUP_POP_SCALE;
  /** 0..1 on/off envelope for the vignette; pulses while at 1. */
  private vignetteEnvelope = 0;
  private vignetteOn = false;
  private vignettePhaseMs = 0;

  constructor(bus: Emitter<GameEvents>) {
    this.scoreText = new Text({
      text: "SCORE 0",
      style: neonStyle(0x9678c8, {
        fontSize: 30,
        fontWeight: "700",
        stroke: { color: 0x9678c8, width: 2 },
        dropShadow: {
          color: 0x9678c8,
          blur: 10,
          distance: 0,
          angle: 0,
          alpha: 0.8,
        },
      }),
    });
    // Second row down: the top-left corner is reserved for gameplay's
    // pause / lobby buttons.
    this.scoreText.position.set(24, 80);

    // Big, airy digits: a light face so the count reads as a glow number,
    // not a wall of ink. Helvetica Neue carries real thin weights on
    // macOS; elsewhere it falls back to regular Arial.
    this.comboText = new Text({
      text: "",
      style: neonStyle(0xb87ae0, {
        fontFamily: "Helvetica Neue, Arial",
        fontSize: 112,
        fontWeight: "200",
        stroke: { color: 0xb87ae0, width: 2 },
        dropShadow: {
          color: 0xa06ae0,
          blur: 24,
          distance: 0,
          angle: 0,
          alpha: 0.9,
        },
      }),
    });
    this.comboText.anchor.set(0.5);
    this.comboText.position.set(VIRTUAL_WIDTH / 2, COMBO_NUMBER_Y);

    this.comboLabel = new Text({
      text: "COMBO",
      style: neonStyle(0x9f8fd8, {
        fontSize: 20,
        fontWeight: "700",
        letterSpacing: 3,
        stroke: { color: 0x9f8fd8, width: 1 },
        dropShadow: {
          color: 0x9f8fd8,
          blur: 8,
          distance: 0,
          angle: 0,
          alpha: 0.9,
        },
      }),
    });
    this.comboLabel.anchor.set(0.5);
    this.comboLabel.position.set(VIRTUAL_WIDTH / 2, COMBO_LABEL_Y);
    this.comboLabel.visible = false;

    this.popup = new Text({ text: "", style: POPUP_STYLES.perfect });
    this.popup.anchor.set(0.5);
    this.popup.position.set(VIRTUAL_WIDTH / 2, POPUP_Y);
    this.popup.alpha = 0;

    // Four inward-fading strips; overlapping corners stack brighter,
    // which is exactly the vignette look. Additive so it reads as light.
    this.vignette = new Container();
    const w = VIRTUAL_WIDTH;
    const h = VIRTUAL_HEIGHT;
    const d = VIGNETTE_DEPTH;
    this.vignette.addChild(
      edgeStrip(0, 0, w, d, { x: 0, y: 0 }, { x: 0, y: 1 }),
      edgeStrip(0, h - d, w, d, { x: 0, y: 1 }, { x: 0, y: 0 }),
      edgeStrip(0, 0, d, h, { x: 0, y: 0 }, { x: 1, y: 0 }),
      edgeStrip(w - d, 0, d, h, { x: 1, y: 0 }, { x: 0, y: 0 }),
    );
    for (const strip of this.vignette.children) strip.blendMode = "add";
    this.vignette.alpha = 0;

    this.view.addChild(
      this.vignette,
      this.scoreText,
      this.comboText,
      this.comboLabel,
      this.popup,
    );

    bus.on("judgement", ({ judgement, combo, score }) => {
      this.scoreText.text = `SCORE ${score}`;
      this.comboText.text = combo >= 2 ? `${combo}` : "";
      this.comboLabel.visible = combo >= 2;
      const extraordinary =
        judgement !== "miss" && combo >= EXTRAORDINARY_COMBO;
      this.popup.text = extraordinary
        ? "EXTRAORDINARY"
        : judgement.toUpperCase();
      this.popup.style =
        POPUP_STYLES[extraordinary ? "extraordinary" : judgement];
      this.popupPopScale = extraordinary
        ? EXTRAORDINARY_POP_SCALE
        : POPUP_POP_SCALE;
      this.popupAgeMs = 0;
      // Green frame light lives and dies with the streak: any miss (or
      // dropping below the threshold) switches it off.
      this.vignetteOn = extraordinary;
    });
  }

  update(ticker: Ticker): void {
    // Vignette: quick attack when the streak ignites, quicker cut on a
    // miss, gentle throb while alive.
    this.vignetteEnvelope = this.vignetteOn
      ? Math.min(1, this.vignetteEnvelope + ticker.deltaMS / VIGNETTE_ATTACK_MS)
      : Math.max(
          0,
          this.vignetteEnvelope - ticker.deltaMS / VIGNETTE_RELEASE_MS,
        );
    if (this.vignetteEnvelope > 0) {
      this.vignettePhaseMs += ticker.deltaMS;
      const pulse =
        VIGNETTE_BASE_ALPHA +
        VIGNETTE_PULSE_ALPHA *
          Math.sin(
            (this.vignettePhaseMs / 1000) * Math.PI * 2 * VIGNETTE_PULSE_HZ,
          );
      this.vignette.alpha = this.vignetteEnvelope * pulse;
    } else {
      this.vignette.alpha = 0;
      this.vignettePhaseMs = 0;
    }

    this.popupAgeMs += ticker.deltaMS;
    if (this.popupAgeMs <= POPUP_HOLD_MS) {
      // Quick settle from an overshoot pop to full size.
      const k = Math.min(1, this.popupAgeMs / 80);
      const pop = this.popupPopScale;
      this.popup.scale.set(pop - (pop - 1) * k);
      this.popup.alpha = 1;
    } else {
      const fade = (this.popupAgeMs - POPUP_HOLD_MS) / POPUP_FADE_MS;
      this.popup.alpha = Math.max(0, 1 - fade);
    }
  }
}
