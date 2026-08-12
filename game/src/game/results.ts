import { Container, Text } from "pixi.js";
import { VIRTUAL_HEIGHT, VIRTUAL_WIDTH } from "../config";
import type { PlayResults } from "./score";
import type { Scene } from "./scenes";

const GRADE_TINT: Readonly<Record<string, number>> = {
  S: 0xffd75c,
  A: 0x5cd7ff,
  B: 0x7de07d,
  C: 0x9f8fd8,
  D: 0xff5c5c,
};

/** Results screen: grade + numbers from the play; Enter returns to lobby. */
export class ResultsScene implements Scene {
  readonly view = new Container();

  constructor(
    results: PlayResults,
    private readonly onDone: () => void,
  ) {
    const grade = new Text({
      text: results.grade,
      style: {
        fontFamily: "Arial",
        fontSize: 160,
        fontWeight: "900",
        fill: GRADE_TINT[results.grade] ?? 0xffffff,
      },
    });
    grade.anchor.set(0.5);
    grade.position.set(VIRTUAL_WIDTH / 2, VIRTUAL_HEIGHT * 0.28);

    const line = (
      text: string,
      y: number,
      fontSize: number,
      fill: number,
    ): Text => {
      const t = new Text({
        text,
        style: { fontFamily: "Arial", fontSize, fill },
      });
      t.anchor.set(0.5);
      t.position.set(VIRTUAL_WIDTH / 2, y);
      return t;
    };

    const c = results.counts;
    const accuracyPct = (results.accuracy * 100).toFixed(1);
    this.view.addChild(
      grade,
      line(
        `SCORE ${results.score}   ·   ACCURACY ${accuracyPct}%   ·   MAX COMBO ${results.maxCombo}`,
        VIRTUAL_HEIGHT * 0.52,
        32,
        0xffffff,
      ),
      line(
        `perfect ${c.perfect} · great ${c.great} · good ${c.good} · miss ${c.miss}`,
        VIRTUAL_HEIGHT * 0.62,
        24,
        0x9f8fd8,
      ),
      line("press Enter for lobby", VIRTUAL_HEIGHT * 0.78, 24, 0x5a4d85),
    );
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

  update(): void {}
}
