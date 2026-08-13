import { Container, Text } from "pixi.js";
import { VIRTUAL_HEIGHT, VIRTUAL_WIDTH } from "../config";
import { difficultyLabel } from "../core/difficulty";
import { activeRoom, type NetRoom } from "../net/room";
import type { FinishMsg } from "../net/protocol";
import { gradeFor, type PlayResults } from "./score";
import type { Scene } from "./scenes";

const GRADE_TINT: Readonly<Record<string, number>> = {
  S: 0xffd75c,
  A: 0x5cd7ff,
  B: 0x7de07d,
  C: 0x9f8fd8,
  D: 0xff5c5c,
};

const VERDICT_TINT = {
  win: 0xffd75c,
  lose: 0x9f8fd8,
  tie: 0x5cd7ff,
} as const;

/**
 * Results: grade + numbers from the play. In a room it splits into two
 * columns and waits for the opponent's finish — one side always crosses the
 * line first, so the versus panel fills in live rather than blocking.
 */
export class ResultsScene implements Scene {
  readonly view = new Container();

  private readonly room: NetRoom | null;
  private readonly unsubscribes: (() => void)[] = [];
  private opponentLines: Text | null = null;
  private opponentGrade: Text | null = null;
  private opponentDifficulty: Text | null = null;
  private verdictText: Text | null = null;

  constructor(
    private readonly results: PlayResults,
    private readonly difficultyLabel: string,
    private readonly onDone: () => void,
  ) {
    this.room = activeRoom();
    const versus = (this.room?.peers.length ?? 0) > 0;

    if (versus) this.buildVersus();
    else this.buildSolo();

    this.view.addChild(
      this.line("press Enter for lobby", VIRTUAL_HEIGHT * 0.85, 24, 0x5a4d85),
    );
  }

  private line(text: string, y: number, fontSize: number, fill: number): Text {
    const t = new Text({
      text,
      style: { fontFamily: "Arial", fontSize, fill },
    });
    t.anchor.set(0.5);
    t.position.set(VIRTUAL_WIDTH / 2, y);
    return t;
  }

  /** Column-local variant of `line`, centered on `x`. */
  private column(
    text: string,
    x: number,
    y: number,
    fontSize: number,
    fill: number,
  ): Text {
    const t = new Text({
      text,
      style: { fontFamily: "Arial", fontSize, fill },
    });
    t.anchor.set(0.5);
    t.position.set(x, y);
    return t;
  }

  private buildSolo(): void {
    const grade = new Text({
      text: this.results.grade,
      style: {
        fontFamily: "Arial",
        fontSize: 160,
        fontWeight: "900",
        fill: GRADE_TINT[this.results.grade] ?? 0xffffff,
      },
    });
    grade.anchor.set(0.5);
    grade.position.set(VIRTUAL_WIDTH / 2, VIRTUAL_HEIGHT * 0.28);

    const c = this.results.counts;
    const accuracyPct = (this.results.accuracy * 100).toFixed(1);
    this.view.addChild(
      grade,
      // A grade means nothing without the difficulty it was earned on.
      this.line(this.difficultyLabel, VIRTUAL_HEIGHT * 0.42, 26, 0xcfc4f2),
      this.line(
        `SCORE ${this.results.score}   ·   ACCURACY ${accuracyPct}%   ·   MAX COMBO ${this.results.maxCombo}`,
        VIRTUAL_HEIGHT * 0.52,
        32,
        0xffffff,
      ),
      this.line(
        `perfect ${c.perfect} · great ${c.great} · good ${c.good} · miss ${c.miss}`,
        VIRTUAL_HEIGHT * 0.62,
        24,
        0x9f8fd8,
      ),
    );
  }

  private buildVersus(): void {
    const leftX = VIRTUAL_WIDTH * 0.28;
    const rightX = VIRTUAL_WIDTH * 0.72;
    const r = this.results;

    this.verdictText = this.line("", VIRTUAL_HEIGHT * 0.14, 44, 0xffffff);
    (this.verdictText.style as { fontWeight?: string }).fontWeight = "900";

    const grade = new Text({
      text: r.grade,
      style: {
        fontFamily: "Arial",
        fontSize: 110,
        fontWeight: "900",
        fill: GRADE_TINT[r.grade] ?? 0xffffff,
      },
    });
    grade.anchor.set(0.5);
    grade.position.set(leftX, VIRTUAL_HEIGHT * 0.36);

    this.opponentLines = this.column(
      "waiting for opponent…",
      rightX,
      VIRTUAL_HEIGHT * 0.55,
      24,
      0x9f8fd8,
    );
    // Mirrors the player's grade slot so the columns stay symmetric while
    // their result is still in flight.
    this.opponentGrade = this.column(
      "–",
      rightX,
      VIRTUAL_HEIGHT * 0.36,
      110,
      0x3a2f5c,
    );
    (this.opponentGrade.style as { fontWeight?: string }).fontWeight = "900";
    this.opponentDifficulty = this.column(
      "",
      rightX,
      VIRTUAL_HEIGHT * 0.46,
      20,
      0xcfc4f2,
    );

    this.view.addChild(
      this.opponentGrade,
      this.opponentDifficulty,
      this.verdictText,
      this.column("YOU", leftX, VIRTUAL_HEIGHT * 0.24, 22, 0x8f7bd8),
      // Difficulty under each name: players pick independently, so a column
      // of numbers without it invites a false comparison.
      this.column(
        this.difficultyLabel,
        leftX,
        VIRTUAL_HEIGHT * 0.46,
        20,
        0xcfc4f2,
      ),
      grade,
      this.column(
        this.statLines(r.score, r.accuracy, r.maxCombo),
        leftX,
        VIRTUAL_HEIGHT * 0.55,
        24,
        0xffffff,
      ),
      this.column(
        this.opponentName(),
        rightX,
        VIRTUAL_HEIGHT * 0.24,
        22,
        0x8f7bd8,
      ),
      this.opponentLines,
    );

    // Their finish may already have arrived while we were still playing.
    const existing = this.room?.peers[0]?.finish;
    if (existing) this.applyOpponent(existing);
    this.subscribe();
  }

  private opponentName(): string {
    return (this.room?.peers[0]?.name ?? "OPPONENT").toUpperCase();
  }

  private statLines(score: number, accuracy: number, maxCombo: number): string {
    return `SCORE ${score}\nACCURACY ${(accuracy * 100).toFixed(1)}%\nMAX COMBO ${maxCombo}`;
  }

  private subscribe(): void {
    const room = this.room;
    if (!room) return;
    this.unsubscribes.push(
      room.bus.on("finish", ({ msg }) => {
        this.applyOpponent(msg);
      }),
      room.bus.on("peers", (peers) => {
        if (peers.length === 0 && this.opponentLines && !this.verdictSet) {
          this.opponentLines.text = "opponent left";
        }
      }),
    );
  }

  private verdictSet = false;

  private applyOpponent(msg: FinishMsg): void {
    if (!this.opponentLines) return;
    this.opponentLines.text = this.statLines(
      msg.score,
      msg.accuracy,
      msg.maxCombo,
    );
    this.opponentLines.style.fill = 0xffffff;
    if (this.opponentGrade) {
      const grade = gradeFor(msg.accuracy);
      this.opponentGrade.text = grade;
      this.opponentGrade.style.fill = GRADE_TINT[grade] ?? 0xffffff;
    }
    const theirDifficulty = difficultyLabel(msg.difficulty);
    if (this.opponentDifficulty) {
      this.opponentDifficulty.text = theirDifficulty;
    }
    if (!this.verdictText) return;

    // Raw score isn't comparable across difficulties — a hard chart pays more
    // per note — so a mixed room is judged on accuracy, and says so rather
    // than quietly changing the rules.
    const sameDifficulty = theirDifficulty === this.difficultyLabel;
    const mine = sameDifficulty ? this.results.score : this.results.accuracy;
    const theirs = sameDifficulty ? msg.score : msg.accuracy;
    const outcome = mine > theirs ? "win" : mine < theirs ? "lose" : "tie";
    const suffix = sameDifficulty ? "" : " (on accuracy)";
    const label =
      outcome === "win" ? "YOU WIN" : outcome === "lose" ? "YOU LOSE" : "TIE";
    this.verdictText.text = `${label}${suffix}`;
    this.verdictText.style.fill = VERDICT_TINT[outcome];
    this.verdictSet = true;
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Enter") this.onDone();
  };

  enter(): void {
    window.addEventListener("keydown", this.onKeyDown);
  }

  exit(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    for (const off of this.unsubscribes) off();
    this.unsubscribes.length = 0;
  }

  update(): void {}
}
