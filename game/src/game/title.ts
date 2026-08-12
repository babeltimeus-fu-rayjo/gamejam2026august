import { Container, Graphics, Text, Ticker } from "pixi.js";
import { VIRTUAL_HEIGHT, VIRTUAL_WIDTH } from "../config";
import { NeonTunnel } from "./neon-tunnel";
import type { Scene } from "./scenes";

/** Placeholder title screen: any key starts the game. */
export class TitleScene implements Scene {
  readonly view = new Container();

  private readonly tunnel: NeonTunnel;
  private readonly hint: Text;
  private elapsed = 0;

  constructor(private readonly onStart: () => void) {
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
    title.position.set(VIRTUAL_WIDTH / 2, VIRTUAL_HEIGHT * 0.4);

    this.hint = new Text({
      text: "press any key",
      style: {
        fontFamily: "Arial",
        fontSize: 32,
        letterSpacing: 4,
        fill: 0x9f8fd8,
      },
    });
    this.hint.anchor.set(0.5);
    this.hint.position.set(VIRTUAL_WIDTH / 2, VIRTUAL_HEIGHT * 0.62);

    this.view.addChild(this.tunnel, scrim, title, this.hint);
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    this.onStart();
  };

  enter(): void {
    window.addEventListener("keydown", this.onKeyDown);
  }

  exit(): void {
    window.removeEventListener("keydown", this.onKeyDown);
  }

  update(ticker: Ticker): void {
    this.elapsed += ticker.deltaMS;
    this.tunnel.update(ticker);
    this.hint.alpha = 0.55 + 0.45 * Math.sin(this.elapsed / 350);
  }
}
