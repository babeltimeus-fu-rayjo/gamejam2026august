import { BitmapText, Container, Ticker } from "pixi.js";
import { VIRTUAL_WIDTH } from "../config";
import type { Emitter } from "../core/events";
import type { Judgement } from "../game/judge";
import type { GameEvents } from "../game/score";
import { TRACK_TOP } from "../game/track";

// BitmapText throughout: score/combo/judgement change constantly, and
// bitmap glyphs just reposition quads instead of re-rendering a canvas.
const JUDGEMENT_TINT: Readonly<Record<Judgement, number>> = {
  perfect: 0xffd75c,
  great: 0x5cd7ff,
  good: 0x9f8fd8,
  miss: 0xff5c5c,
};

const POPUP_HOLD_MS = 250;
const POPUP_FADE_MS = 350;

/** Score / combo readouts + judgement popup, driven by the gameplay bus. */
export class Hud {
  readonly view = new Container();

  private readonly scoreText: BitmapText;
  private readonly comboText: BitmapText;
  private readonly popup: BitmapText;
  private popupAgeMs = Infinity;

  constructor(bus: Emitter<GameEvents>) {
    this.scoreText = new BitmapText({
      text: "SCORE 0",
      style: { fontFamily: "Arial", fontSize: 30, fill: 0xffffff },
    });
    this.scoreText.position.set(24, TRACK_TOP - 64);

    this.comboText = new BitmapText({
      text: "",
      style: {
        fontFamily: "Arial",
        fontSize: 34,
        fontWeight: "900",
        fill: 0xffffff,
      },
    });
    this.comboText.anchor.set(0.5);
    this.comboText.position.set(VIRTUAL_WIDTH / 2, TRACK_TOP - 48);

    this.popup = new BitmapText({
      text: "",
      style: {
        fontFamily: "Arial",
        fontSize: 52,
        fontWeight: "900",
        fill: 0xffffff,
      },
    });
    this.popup.anchor.set(0.5);
    this.popup.position.set(VIRTUAL_WIDTH / 2, TRACK_TOP - 140);
    this.popup.alpha = 0;

    this.view.addChild(this.scoreText, this.comboText, this.popup);

    bus.on("judgement", ({ judgement, combo, score }) => {
      this.scoreText.text = `SCORE ${score}`;
      this.comboText.text = combo >= 2 ? `${combo} COMBO` : "";
      this.popup.text = judgement.toUpperCase();
      this.popup.tint = JUDGEMENT_TINT[judgement];
      this.popupAgeMs = 0;
    });
  }

  update(ticker: Ticker): void {
    this.popupAgeMs += ticker.deltaMS;
    if (this.popupAgeMs <= POPUP_HOLD_MS) {
      // Quick settle from an overshoot pop to full size.
      const k = Math.min(1, this.popupAgeMs / 80);
      this.popup.scale.set(1.25 - 0.25 * k);
      this.popup.alpha = 1;
    } else {
      const fade = (this.popupAgeMs - POPUP_HOLD_MS) / POPUP_FADE_MS;
      this.popup.alpha = Math.max(0, 1 - fade);
    }
  }
}
