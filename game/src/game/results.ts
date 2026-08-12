import { Container, Text } from "pixi.js";
import { VIRTUAL_HEIGHT, VIRTUAL_WIDTH } from "../config";
import type { Scene } from "./scenes";

/** Placeholder results screen: Enter returns to the lobby. */
export class ResultsScene implements Scene {
  readonly view = new Container();

  constructor(private readonly onDone: () => void) {
    const heading = new Text({
      text: "RESULTS",
      style: {
        fontFamily: "Arial",
        fontSize: 72,
        fontWeight: "900",
        letterSpacing: 6,
        fill: 0xffffff,
      },
    });
    heading.anchor.set(0.5);
    heading.position.set(VIRTUAL_WIDTH / 2, VIRTUAL_HEIGHT * 0.35);

    const body = new Text({
      text: "score / accuracy / max combo land in M2",
      style: { fontFamily: "Arial", fontSize: 28, fill: 0x9f8fd8 },
    });
    body.anchor.set(0.5);
    body.position.set(VIRTUAL_WIDTH / 2, VIRTUAL_HEIGHT * 0.5);

    const hint = new Text({
      text: "press Enter for lobby",
      style: { fontFamily: "Arial", fontSize: 24, fill: 0x5a4d85 },
    });
    hint.anchor.set(0.5);
    hint.position.set(VIRTUAL_WIDTH / 2, VIRTUAL_HEIGHT * 0.68);

    this.view.addChild(heading, body, hint);
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Enter") this.onDone();
  };

  enter(): void {
    window.addEventListener("keydown", this.onKeyDown);
  }

  exit(): void {
    window.removeEventListener("keydown", this.onKeyDown);
  }

  update(): void {
    // static screen
  }
}
