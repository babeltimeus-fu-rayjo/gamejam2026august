import { Container, Graphics, Text, Ticker } from "pixi.js";
import { VIRTUAL_HEIGHT, VIRTUAL_WIDTH, type GameMode } from "../config";
import { Bgm } from "../core/bgm";
import { NeonButton } from "./neon-button";
import { NeonTunnel } from "./neon-tunnel";
import type { Scene } from "./scenes";

const BGM_URL = `${import.meta.env.BASE_URL}audio/LobbyBM.mp3`;

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
 * Title screen: neon tunnel behind, mode select in front, lobby music driving
 * both. The tunnel's camera speed and glow follow the track's low end, so the
 * whole screen moves on the beat.
 */
export class TitleScene implements Scene {
  readonly view = new Container();

  private readonly tunnel: NeonTunnel;
  private readonly buttons: NeonButton[] = [];
  private readonly hint: Text;
  private readonly bgm = new Bgm();
  private focus = 0;
  private elapsed = 0;

  constructor(private readonly onSelect: (mode: GameMode) => void) {
    this.tunnel = new NeonTunnel({
      width: VIRTUAL_WIDTH,
      height: VIRTUAL_HEIGHT,
    });

    // Scrim: the tunnel peaks near white, so the type needs something to sit on.
    const scrim = new Graphics()
      .rect(0, 0, VIRTUAL_WIDTH, VIRTUAL_HEIGHT)
      .fill({ color: 0x05030d, alpha: 0.32 });

    const title = new Text({
      text: "RHYTHM GAME",
      style: {
        fontFamily: "Arial",
        fontSize: 96,
        fontWeight: "900",
        letterSpacing: 8,
        fill: 0xffffff,
      },
    });
    title.anchor.set(0.5);
    title.position.set(VIRTUAL_WIDTH / 2, VIRTUAL_HEIGHT * 0.3);

    this.hint = new Text({
      text: "arrows to choose  ·  enter to start",
      style: {
        fontFamily: "Arial",
        fontSize: 24,
        letterSpacing: 4,
        fill: 0xcfc4f2,
      },
    });
    this.hint.anchor.set(0.5);
    this.hint.position.set(VIRTUAL_WIDTH / 2, VIRTUAL_HEIGHT * 0.84);

    // The tunnel wall behind the hint can be any colour on any given frame, so
    // the line needs its own backing to stay legible.
    const pillH = this.hint.height + 20;
    const hintPill = new Graphics()
      .roundRect(
        this.hint.x - this.hint.width / 2 - 24,
        this.hint.y - pillH / 2,
        this.hint.width + 48,
        pillH,
        pillH / 2,
      )
      .fill({ color: 0x05030d, alpha: 0.55 });

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

    this.view.addChild(this.tunnel, scrim, title, hintPill, this.hint, version);

    const row = MODES.length * BUTTON_WIDTH + (MODES.length - 1) * BUTTON_GAP;
    MODES.forEach((m, i) => {
      const button = new NeonButton({
        label: m.label,
        sub: m.sub,
        width: BUTTON_WIDTH,
        height: BUTTON_HEIGHT,
        color: m.color,
        onActivate: () => this.choose(m.mode),
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

    void this.bgm
      .load(BGM_URL)
      .then(() => this.bgm.play())
      .catch((err) => console.warn("[title] bgm unavailable", err));
  }

  exit(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("pointerdown", this.onPointerDown);
    this.bgm.destroy();
  }

  update(ticker: Ticker): void {
    const dt = ticker.deltaMS / 1000;
    this.elapsed += dt;

    this.bgm.sample(dt);
    this.tunnel.update(dt, this.bgm.level, this.bgm.kick);
    for (const button of this.buttons) button.update(dt, this.bgm.kick);

    this.hint.alpha = 0.55 + 0.45 * Math.sin(this.elapsed * 2.9);
  }
}
