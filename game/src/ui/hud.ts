import {
  Container,
  FillGradient,
  Graphics,
  Text,
  type TextStyle,
  Ticker,
} from "pixi.js";
import { VIRTUAL_HEIGHT, VIRTUAL_WIDTH } from "../config";
import { neonStyle } from "./neon-text";
import type { Emitter } from "../core/events";
import { TIER_COLOR, type FeedbackTier } from "../game/feedback";
import { MAX_LIFE, type GameEvents } from "../game/score";

// The neon text look itself lives in ui/neon-text.ts — the results screen wears
// it too, and the two have to stay identical.
// Colours come from the shared judgement palette (game/feedback.ts), so the
// popup and the lane's reaction zone light up in the same colour.

// One prebuilt style per popup tier; swapping styles re-renders the text.
const POPUP_STYLES: Readonly<Record<FeedbackTier, TextStyle>> = {
  perfect: neonStyle(TIER_COLOR.perfect, { fontSize: 52 }),
  great: neonStyle(TIER_COLOR.great, { fontSize: 52 }),
  good: neonStyle(TIER_COLOR.good, { fontSize: 52 }),
  miss: neonStyle(TIER_COLOR.miss, { fontSize: 52 }),
  extraordinary: neonStyle(TIER_COLOR.extraordinary, {
    fontSize: 52,
    dropShadow: {
      color: TIER_COLOR.extraordinary,
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
// light in the tier's own colour (edge vignette). A miss kills it
// immediately; it must be re-earned with the combo.
const VIGNETTE_DEPTH = 140;
/** TIER_COLOR.extraordinary as rgb components, for the gradient's rgba(). */
const VIGNETTE_RGB = "176, 92, 255";
const VIGNETTE_ATTACK_MS = 120;
const VIGNETTE_RELEASE_MS = 150;
// Lighter than the green frame it replaces: purple sits much closer to the
// track's own colour, so the same alpha washed the lanes out.
const VIGNETTE_BASE_ALPHA = 0.28;
const VIGNETTE_PULSE_ALPHA = 0.18;
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

// Life gauge (top-right): pink bar + numeric readout. Misses drain it;
// an empty gauge fails the run. Pulses once it gets low.
const LIFE_PINK = 0xff6fae;
const LIFE_BAR_W = 240;
const LIFE_BAR_H = 12;
const LIFE_X = VIRTUAL_WIDTH - 24 - LIFE_BAR_W;
const LIFE_TEXT_Y = 30;
const LIFE_BAR_Y = 46;
const LIFE_LOW_FRACTION = 0.25;

/** Score / combo readouts + judgement popup, driven by the gameplay bus. */
export class Hud {
  readonly view = new Container();

  private readonly scoreText: Text;
  private readonly comboText: Text;
  private readonly comboLabel: Text;
  private readonly popup: Text;
  private readonly vignette: Container;
  private readonly lifeValue: Text;
  private readonly lifeFill: Graphics;
  private lifeFraction = 1;
  private lifePulseMs = 0;
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

    // Life gauge: LIFE label left of the bar, count right-aligned above
    // the bar's right end, pink fill redrawn only when life changes.
    const lifeLabel = new Text({
      text: "LIFE",
      style: neonStyle(LIFE_PINK, {
        fontSize: 22,
        letterSpacing: 3,
        stroke: { color: LIFE_PINK, width: 1 },
        dropShadow: {
          color: LIFE_PINK,
          blur: 10,
          distance: 0,
          angle: 0,
          alpha: 0.9,
        },
      }),
    });
    lifeLabel.anchor.set(0, 0.5);
    lifeLabel.position.set(LIFE_X, LIFE_TEXT_Y);

    this.lifeValue = new Text({
      text: `${MAX_LIFE}`,
      style: neonStyle(LIFE_PINK, {
        fontSize: 22,
        fontWeight: "700",
        stroke: { color: LIFE_PINK, width: 1 },
        dropShadow: {
          color: LIFE_PINK,
          blur: 10,
          distance: 0,
          angle: 0,
          alpha: 0.9,
        },
      }),
    });
    this.lifeValue.anchor.set(1, 0.5);
    this.lifeValue.position.set(LIFE_X + LIFE_BAR_W, LIFE_TEXT_Y);

    const lifeBack = new Graphics()
      .roundRect(LIFE_X, LIFE_BAR_Y, LIFE_BAR_W, LIFE_BAR_H, 6)
      .fill({ color: 0x1d1630, alpha: 0.85 })
      .stroke({ width: 1.5, color: LIFE_PINK, alpha: 0.5 });
    this.lifeFill = new Graphics();
    this.redrawLife();

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
      lifeLabel,
      this.lifeValue,
      lifeBack,
      this.lifeFill,
    );

    bus.on("judgement", ({ tier, combo, score, life }) => {
      this.scoreText.text = `SCORE ${score}`;
      const fraction = life / MAX_LIFE;
      if (fraction !== this.lifeFraction) {
        this.lifeFraction = fraction;
        this.lifeValue.text = `${life}`;
        this.redrawLife();
      }
      this.comboText.text = combo >= 2 ? `${combo}` : "";
      this.comboLabel.visible = combo >= 2;
      const extraordinary = tier === "extraordinary";
      this.popup.text = tier.toUpperCase();
      this.popup.style = POPUP_STYLES[tier];
      this.popupPopScale = extraordinary
        ? EXTRAORDINARY_POP_SCALE
        : POPUP_POP_SCALE;
      this.popupAgeMs = 0;
      // The frame light lives and dies with the streak: any miss (or
      // dropping below the threshold) switches it off.
      this.vignetteOn = extraordinary;
    });
  }

  /** Pink fill, proportional to life; rounded ends need a minimum width. */
  private redrawLife(): void {
    this.lifeFill.clear();
    if (this.lifeFraction <= 0) return;
    const w = Math.max(LIFE_BAR_H - 4, (LIFE_BAR_W - 4) * this.lifeFraction);
    this.lifeFill
      .roundRect(LIFE_X + 2, LIFE_BAR_Y + 2, w, LIFE_BAR_H - 4, 4)
      .fill(LIFE_PINK);
  }

  update(ticker: Ticker): void {
    // Low life: the fill blinks urgency, full alpha otherwise.
    if (this.lifeFraction > 0 && this.lifeFraction < LIFE_LOW_FRACTION) {
      this.lifePulseMs += ticker.deltaMS;
      this.lifeFill.alpha = 0.65 + 0.35 * Math.sin(this.lifePulseMs / 90);
    } else {
      this.lifeFill.alpha = 1;
      this.lifePulseMs = 0;
    }

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
