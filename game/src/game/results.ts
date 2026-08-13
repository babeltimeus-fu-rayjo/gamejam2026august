import { Container, Graphics, Rectangle, Text, Ticker } from "pixi.js";
import { VIRTUAL_HEIGHT, VIRTUAL_WIDTH } from "../config";
import { difficultyLabel } from "../core/difficulty";
import { activeRoom, type NetRoom } from "../net/room";
import type { FinishMsg } from "../net/protocol";
import { gradeFor, type PlayResults } from "./score";
import { drawPanel } from "./panel";
import type { Scene } from "./scenes";
import { VideoBackdrop } from "./video-backdrop";

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

/** Solo stat panel, sized like a double-height lobby row. */
const SOLO_PANEL_WIDTH = 640;
const SOLO_PANEL_HEIGHT = 130;
const SOLO_PANEL_Y = 400;

/** Versus: one wide slab carries both players' numbers. */
const VS_PANEL_WIDTH = 1000;
const VS_PANEL_HEIGHT = 190;
const VS_PANEL_Y = 345;

/**
 * Results: grade + numbers from the play, dressed like the other menus —
 * same video backdrop, heading type, and panel slabs as the lobby, with the
 * HUD's neon glow on the headline grade. In a room it splits into two
 * columns and waits for the opponent's finish — one side always crosses the
 * line first, so the versus panel fills in live rather than blocking.
 */
export class ResultsScene implements Scene {
  readonly view = new Container();

  private readonly backdrop = new VideoBackdrop();
  private readonly footer: Text;
  private readonly room: NetRoom | null;
  private readonly unsubscribes: (() => void)[] = [];
  private opponentLines: Text | null = null;
  private opponentGrade: Text | null = null;
  private opponentDifficulty: Text | null = null;
  private verdictText: Text | null = null;
  private elapsed = 0;

  constructor(
    private readonly results: PlayResults,
    private readonly difficultyLabel: string,
    private readonly onDone: () => void,
  ) {
    this.room = activeRoom();
    const versus = (this.room?.peers.length ?? 0) > 0;

    this.view.addChild(this.backdrop);

    // The whole screen is the "continue" button — there's nothing else to
    // tap here, and it's the touch twin of the Enter key.
    const tapCatcher = new Container();
    tapCatcher.eventMode = "static";
    tapCatcher.hitArea = new Rectangle(0, 0, VIRTUAL_WIDTH, VIRTUAL_HEIGHT);
    tapCatcher.on("pointertap", () => this.onDone());
    this.view.addChild(tapCatcher);

    if (versus) this.buildVersus();
    else this.buildSolo();

    // Pulses in update(), the same invitation the lobby's START makes.
    this.footer = this.line(
      "press Enter or tap for lobby",
      VIRTUAL_HEIGHT * 0.88,
      24,
      0xcfc4f2,
    );
    this.view.addChild(this.footer);
  }

  /** Heading in the LOBBY/PAUSED display style, shared across the menus. */
  private heading(text: string, y: number, fontSize: number): Text {
    const t = new Text({
      text,
      style: {
        fontFamily: "Arial",
        fontSize,
        fontWeight: "900",
        letterSpacing: 6,
        fill: 0xffffff,
      },
    });
    t.anchor.set(0.5);
    t.position.set(VIRTUAL_WIDTH / 2, y);
    return t;
  }

  /** Headline grade: white-hot core with the tint as rim and glow halo. */
  private gradeText(grade: string, x: number, y: number, size: number): Text {
    const tint = GRADE_TINT[grade] ?? 0xffffff;
    const t = new Text({
      text: grade,
      style: {
        fontFamily: "Arial",
        fontSize: size,
        fontWeight: "900",
        fill: tint,
        stroke: { color: tint, width: 2 },
        dropShadow: {
          color: tint,
          blur: 26,
          distance: 0,
          angle: 0,
          alpha: 0.9,
        },
      },
    });
    t.anchor.set(0.5);
    t.position.set(x, y);
    return t;
  }

  private panel(width: number, height: number, y: number): Graphics {
    const g = new Graphics();
    drawPanel(g, width, height);
    g.position.set((VIRTUAL_WIDTH - width) / 2, y);
    return g;
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
      style: { fontFamily: "Arial", fontSize, fill, align: "center" },
    });
    t.anchor.set(0.5);
    t.position.set(x, y);
    return t;
  }

  private buildSolo(): void {
    const c = this.results.counts;
    const accuracyPct = (this.results.accuracy * 100).toFixed(1);
    this.view.addChild(
      this.heading("RESULTS", VIRTUAL_HEIGHT * 0.13, 64),
      this.gradeText(this.results.grade, VIRTUAL_WIDTH / 2, 255, 160),
      // A grade means nothing without the difficulty it was earned on.
      this.line(this.difficultyLabel, 352, 26, 0xcfc4f2),
      this.panel(SOLO_PANEL_WIDTH, SOLO_PANEL_HEIGHT, SOLO_PANEL_Y),
      this.line(
        `SCORE ${this.results.score}   ·   ACCURACY ${accuracyPct}%   ·   MAX COMBO ${this.results.maxCombo}`,
        SOLO_PANEL_Y + 44,
        28,
        0xffffff,
      ),
      this.line(
        `perfect ${c.perfect} · great ${c.great} · good ${c.good} · miss ${c.miss}`,
        SOLO_PANEL_Y + 92,
        24,
        0x9f8fd8,
      ),
    );
  }

  private buildVersus(): void {
    const leftX = VIRTUAL_WIDTH * 0.28;
    const rightX = VIRTUAL_WIDTH * 0.72;
    const r = this.results;
    const statsY = VS_PANEL_Y + VS_PANEL_HEIGHT / 2;

    // Fills in (with its glow) once the verdict is known.
    this.verdictText = this.heading("", 128, 48);

    this.opponentLines = this.column(
      "waiting for opponent…",
      rightX,
      statsY,
      24,
      0x9f8fd8,
    );
    // Mirrors the player's grade slot so the columns stay symmetric while
    // their result is still in flight.
    this.opponentGrade = this.column("–", rightX, 259, 110, 0x3a2f5c);
    (this.opponentGrade.style as { fontWeight?: string }).fontWeight = "900";
    this.opponentDifficulty = this.column("", rightX, 331, 20, 0xcfc4f2);

    this.view.addChild(
      this.heading("RESULTS", 56, 40),
      this.verdictText,
      this.panel(VS_PANEL_WIDTH, VS_PANEL_HEIGHT, VS_PANEL_Y),
      this.opponentGrade,
      this.opponentDifficulty,
      this.column("YOU", leftX, VIRTUAL_HEIGHT * 0.24, 22, 0x8f7bd8),
      // Difficulty under each name: players pick independently, so a column
      // of numbers without it invites a false comparison.
      this.column(this.difficultyLabel, leftX, 331, 20, 0xcfc4f2),
      this.gradeText(r.grade, leftX, 259, 110),
      this.column(
        this.statLines(r.score, r.accuracy, r.maxCombo),
        leftX,
        statsY,
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
    const tint = VERDICT_TINT[outcome];
    this.verdictText.style.fill = tint;
    // Same neon halo the grades wear, in the verdict's colour.
    this.verdictText.style.dropShadow = {
      color: tint,
      blur: 22,
      distance: 0,
      angle: 0,
      alpha: 0.9,
    };
    this.verdictSet = true;
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Enter") this.onDone();
  };

  enter(): void {
    window.addEventListener("keydown", this.onKeyDown);
    this.backdrop.play();
  }

  exit(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    this.backdrop.pause();
    for (const off of this.unsubscribes) off();
    this.unsubscribes.length = 0;
  }

  update(ticker: Ticker): void {
    this.elapsed += ticker.deltaMS;
    this.footer.alpha = 0.55 + 0.35 * Math.sin(this.elapsed / 350);
  }
}
