import { Container, Graphics, Text } from "pixi.js";
import { VIRTUAL_HEIGHT, VIRTUAL_WIDTH } from "../config";
import type { Scene } from "./scenes";

// M0 placeholder: a static wireframe of the final layout (art area on top,
// 4-lane track on the bottom, hit line + receptors on the RIGHT edge).
// The real track renderer replaces this in M2.
const TRACK_TOP = VIRTUAL_HEIGHT * 0.6;
const LANE_HEIGHT = (VIRTUAL_HEIGHT - TRACK_TOP) / 4;
const HIT_X = VIRTUAL_WIDTH - 150;
const LANE_KEYS = ["D", "F", "J", "K"] as const;

/** Placeholder gameplay screen: shows the layout wireframe, Enter finishes. */
export class GameplayScene implements Scene {
  readonly view = new Container();

  constructor(private readonly onFinish: () => void) {
    const g = new Graphics();

    // lane strips (alternating fills), spanning the full width
    for (let lane = 0; lane < 4; lane++) {
      const y = TRACK_TOP + lane * LANE_HEIGHT;
      g.rect(0, y, VIRTUAL_WIDTH, LANE_HEIGHT).fill(
        lane % 2 === 0 ? 0x181226 : 0x1d1630,
      );
    }
    // track / art-area divider
    g.rect(0, TRACK_TOP - 2, VIRTUAL_WIDTH, 2).fill(0x3a2f5c);
    // hit line
    g.rect(HIT_X, TRACK_TOP, 4, VIRTUAL_HEIGHT - TRACK_TOP).fill(0xff5c8a);
    this.view.addChild(g);

    // receptor boxes + key labels, one per lane
    for (let lane = 0; lane < 4; lane++) {
      const cy = TRACK_TOP + (lane + 0.5) * LANE_HEIGHT;
      const box = new Graphics()
        .roundRect(HIT_X + 24, cy - 26, 52, 52, 8)
        .stroke({ width: 3, color: 0x8f7bd8 });
      const label = new Text({
        text: LANE_KEYS[lane],
        style: {
          fontFamily: "Arial",
          fontSize: 28,
          fontWeight: "700",
          fill: 0xcfc4f2,
        },
      });
      label.anchor.set(0.5);
      label.position.set(HIT_X + 50, cy);
      this.view.addChild(box, label);
    }

    const artHint = new Text({
      text: "ART AREA — reactive stage lands in M4",
      style: { fontFamily: "Arial", fontSize: 28, fill: 0x5a4d85 },
    });
    artHint.anchor.set(0.5);
    artHint.position.set(VIRTUAL_WIDTH / 2, TRACK_TOP / 2);

    const hint = new Text({
      text: "GAMEPLAY placeholder — press Enter for results",
      style: { fontFamily: "Arial", fontSize: 20, fill: 0x9f8fd8 },
    });
    hint.position.set(24, TRACK_TOP - 40);

    this.view.addChild(artHint, hint);
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Enter") this.onFinish();
  };

  enter(): void {
    window.addEventListener("keydown", this.onKeyDown);
  }

  exit(): void {
    window.removeEventListener("keydown", this.onKeyDown);
  }

  update(): void {
    // static wireframe; nothing to animate yet
  }
}
