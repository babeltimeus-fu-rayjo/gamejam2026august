import { Container, Text, Ticker } from "pixi.js";
import { VIRTUAL_HEIGHT, VIRTUAL_WIDTH, type GameMode } from "../config";
import { menuBgm, startMenuBgm } from "../core/bgm";
import { NeonButton } from "./neon-button";
import type { Scene } from "./scenes";
import { VideoBackdrop } from "./video-backdrop";

const BUTTON_WIDTH = 300;
const BUTTON_HEIGHT = 108;
const BUTTON_GAP = 56;

const MODES: readonly {
  mode: GameMode;
  label: string;
  sub: string;
  color: number;
}[] = [
  { mode: "single", label: "SINGLE", sub: "solo run", color: 0x35f0ff },
  { mode: "battle", label: "BATTLE", sub: "head to head", color: 0xff45c8 },
];

/**
 * Title screen: the lobby's background video behind, mode select in front,
 * lobby music over the top. The video plays on through into the lobby, which
 * shares both the clip and the panel style.
 */
export class TitleScene implements Scene {
  readonly view = new Container();

  private readonly backdrop = new VideoBackdrop();
  private readonly buttons: NeonButton[] = [];
  private readonly hint: Text;
  private readonly bgm = menuBgm();
  private focus = 0;
  private elapsed = 0;

  constructor(private readonly onSelect: (mode: GameMode) => void) {
    const title = new Text({
      text: "OFF-BEAT ORDINARY",
      style: {
        fontFamily: "Arial",
        // 96 fit the old two-word name; the longer title needs the smaller
        // size to keep a margin inside the 1280 virtual width.
        fontSize: 76,
        fontWeight: "900",
        letterSpacing: 8,
        fill: 0xffffff,
      },
    });
    title.anchor.set(0.5);
    title.position.set(VIRTUAL_WIDTH / 2, VIRTUAL_HEIGHT * 0.3);

    this.hint = new Text({
      text: "tap a mode  ·  or arrows + enter",
      style: {
        fontFamily: "Arial",
        fontSize: 24,
        letterSpacing: 4,
        fill: 0xcfc4f2,
        // No pill behind the line, so the glyphs carry their own contrast: a
        // dark shadow at zero distance darkens whatever video frame is under
        // them without drawing a box.
        dropShadow: {
          color: 0x05030d,
          alpha: 0.9,
          blur: 6,
          distance: 0,
          angle: 0,
        },
        padding: 8,
      },
    });
    this.hint.anchor.set(0.5);
    this.hint.position.set(VIRTUAL_WIDTH / 2, VIRTUAL_HEIGHT * 0.84);

    // Build stamp, so we can tell which commit a running build came from.
    const version = new Text({
      text: __COMMIT_HASH__,
      style: {
        fontFamily: "monospace",
        fontSize: 18,
        letterSpacing: 2,
        fill: 0x8b7fb0,
      },
    });
    version.anchor.set(1, 1);
    version.position.set(VIRTUAL_WIDTH - 16, VIRTUAL_HEIGHT - 12);

    this.view.addChild(this.backdrop, title, this.hint, version);

    const row = MODES.length * BUTTON_WIDTH + (MODES.length - 1) * BUTTON_GAP;
    MODES.forEach((m, i) => {
      const button = new NeonButton({
        label: m.label,
        sub: m.sub,
        width: BUTTON_WIDTH,
        height: BUTTON_HEIGHT,
        color: m.color,
        onActivate: () => this.choose(m.mode),
        onFocus: () => {
          this.focus = i;
          this.applyFocus();
        },
      });
      button.position.set(
        (VIRTUAL_WIDTH - row) / 2 + i * (BUTTON_WIDTH + BUTTON_GAP),
        VIRTUAL_HEIGHT * 0.58,
      );
      this.buttons.push(button);
      this.view.addChild(button);
    });
    this.applyFocus();
  }

  private choose(mode: GameMode): void {
    // The click that starts the game is also a user gesture, so an autoplay-
    // blocked context unlocks here even if nothing else has been touched yet.
    void this.bgm.resume();
    this.onSelect(mode);
  }

  private applyFocus(): void {
    this.buttons.forEach((b, i) => (b.selected = i === this.focus));
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    void this.bgm.resume();
    if (e.repeat) return;

    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      const step = e.key === "ArrowLeft" ? -1 : 1;
      this.focus = (this.focus + step + MODES.length) % MODES.length;
      this.applyFocus();
    } else if (e.key === "Enter" || e.key === " ") {
      this.choose(MODES[this.focus].mode);
    } else if (e.key === "1" || e.key === "2") {
      this.focus = Number(e.key) - 1;
      this.applyFocus();
      this.choose(MODES[this.focus].mode);
    }
  };

  /** Any pointer contact counts as the gesture that unlocks audio. */
  private readonly onPointerDown = (): void => {
    void this.bgm.resume();
  };

  enter(): void {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("pointerdown", this.onPointerDown);
    this.backdrop.play();
    startMenuBgm();
  }

  exit(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("pointerdown", this.onPointerDown);
    // No pause here: destroying the backdrop stops the clip, and the lobby —
    // which shares it — resumes it from the same frame on the way in. The music
    // is shared the same way and deliberately plays on into the lobby;
    // gameplay is what stops it.
  }

  update(ticker: Ticker): void {
    const dt = ticker.deltaMS / 1000;
    this.elapsed += dt;

    this.bgm.sample(dt);
    for (const button of this.buttons) button.update(dt, this.bgm.kick);

    this.hint.alpha = 0.55 + 0.45 * Math.sin(this.elapsed * 2.9);
  }
}
