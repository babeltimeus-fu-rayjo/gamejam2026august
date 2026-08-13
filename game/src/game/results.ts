import {
  Assets,
  Container,
  Graphics,
  Sprite,
  Text,
  Texture,
  Ticker,
} from "pixi.js";
import { VIRTUAL_HEIGHT, VIRTUAL_WIDTH } from "../config";
import type { CharacterDef, Reaction } from "../art/characters";
import { difficultyLabel } from "../core/difficulty";
import { shakeOffset, TIER_COLOR } from "./feedback";
import { activeRoom, type NetRoom } from "../net/room";
import type { FinishMsg } from "../net/protocol";
import { gradeFor, type PlayResults } from "./score";
import type { Scene } from "./scenes";
import { drawAccentRing, drawPanel } from "./panel";
import { neonStyle, neonText } from "../ui/neon-text";
import { NumberRoll } from "../ui/rolling-number";

/** Still painting behind the panels; 1376x768, shown cover-scaled at 1280x720. */
const BACKDROP_URL = `${import.meta.env.BASE_URL}assets/results/music-room.png`;
/** Extra cover so the impact shake can't drag an edge off the painting. */
const BACKDROP_OVERSCAN = 1.06;

const GRADE_TINT: Readonly<Record<string, number>> = {
  S: 0xffd75c,
  A: 0x35f0ff,
  B: 0x5ce08a,
  C: 0xb87ae0,
  D: 0xff4d5e,
};

/**
 * Headline word per grade. The letter still appears, in the gloss beside the
 * word, so the screen reads as a verdict while the grade stays the currency.
 */
const GRADE_TITLE: Readonly<Record<string, string>> = {
  S: "FLAWLESS",
  A: "BRILLIANT",
  B: "SOLID",
  C: "PASSABLE",
  D: "ROUGH",
};

/** The avatar's parting pose — how the run went, on their face. */
const GRADE_POSE: Readonly<Record<string, Reaction>> = {
  S: "hype",
  A: "hype",
  B: "great",
  C: "good",
  D: "comboBreak",
};

const VERDICT_TINT = {
  win: 0xffd75c,
  lose: 0xb87ae0,
  tie: 0x35f0ff,
} as const;

// Solo layout, in virtual coordinates.
const CARD_WIDTH = 300;
const CARD_HEIGHT = 108;
const CARD_GAP = 32;
const CARD_TOP = 300;
const CENTER_X = VIRTUAL_WIDTH / 2;
const STAMP_Y = 168;
const DIFFICULTY_Y = 242;
const RULE_Y = 272;
const TALLY_Y = 470;
const HINT_Y = VIRTUAL_HEIGHT * 0.85;
/** One accent per stat card, from the palette the title and HUD already use. */
const CARD_ACCENT = [0x35f0ff, 0xb87ae0, 0xff45c8] as const;
const PANEL_VIOLET = 0x9678c8;

// Entrance: a beat of empty screen, the grade slams down like a stamp, the
// impact kicks the camera and throws a ring, and only then do the numbers
// start counting.
const STAMP_DELAY_MS = 140;
const STAMP_TRAVEL_MS = 240;
const STAMP_START_SCALE = 6;
const STAMP_START_TILT = -0.09;
const IMPACT_SHAKE_MS = 200;
const IMPACT_RING_MS = 420;
const IMPACT_FLASH_MS = 160;
const REVEAL_FADE_MS = 180;
/** Whole count-up, start to settled. */
const ROLL_MS = 500;
/** Hint fade after the counting stops, and its idle breathing period. */
const HINT_FADE_MS = 240;

// Versus layout: name, grade word, difficulty, then the stats panel, with the
// opponent's waiting note on its own row beneath it.
const VS_NAME_Y = 182;
const VS_GRADE_Y = 246;
const VS_GRADE_SIZE = 44;
const VS_DIFF_Y = 300;
const VS_STATS_Y = 336;

/** A readout waiting for the stamp to land before it starts counting. */
interface PendingRoll {
  roll: NumberRoll;
  value: number;
}

/**
 * Results: the run's verdict in the game's own neon panels, over a still
 * painting. The grade lands first — stamped down with a camera kick — and the
 * numbers count up to their totals behind it.
 *
 * In a room it splits into two columns and waits for the opponent's finish — one
 * side always crosses the line first, so the versus panel fills in live rather
 * than blocking.
 */
export class ResultsScene implements Scene {
  readonly view = new Container();

  private readonly room: NetRoom | null;
  private readonly unsubscribes: (() => void)[] = [];
  /** Everything the stamp reveals: panels, labels, counting numbers. */
  private readonly reveal = new Container();
  private readonly hint: Container;
  private readonly ring = new Graphics();
  private readonly flash: Graphics;
  private readonly rolls: NumberRoll[] = [];
  /** Count-ups held back until the stamp lands. */
  private readonly pending: PendingRoll[] = [];
  /** The block the impact animates: the grade, in both layouts. */
  private stamp: Container | null = null;
  private ownStats: ColumnStats | null = null;
  private opponentStats: ColumnStats | null = null;
  private opponentNote: Text | null = null;
  private opponentGrade: Text | null = null;
  private opponentDifficulty: Text | null = null;
  private verdictText: Text | null = null;

  private ageMs = 0;
  /** Negative until the stamp lands; ms since the impact after that. */
  private impactAgeMs = -1;
  private shakeAgeMs = IMPACT_SHAKE_MS;
  private verdictAgeMs = Infinity;
  private disposed = false;

  /** Warm the painting while the song's last notes are still on screen. */
  static preload(): Promise<unknown> {
    return Assets.load(BACKDROP_URL).catch(() => undefined);
  }

  constructor(
    private readonly results: PlayResults,
    private readonly difficultyLabel: string,
    private readonly onDone: () => void,
    private readonly character?: CharacterDef,
  ) {
    this.room = activeRoom();
    const versus = (this.room?.peers.length ?? 0) > 0;

    void this.buildBackdrop();

    this.flash = new Graphics()
      .rect(0, 0, VIRTUAL_WIDTH, VIRTUAL_HEIGHT)
      .fill(0xffffff);
    this.flash.blendMode = "add";
    this.flash.alpha = 0;
    this.ring.blendMode = "add";
    this.ring.visible = false;

    this.reveal.alpha = 0;
    this.view.addChild(this.reveal);

    if (versus) this.buildVersus();
    else this.buildSolo();

    this.hint = this.buildHint(HINT_Y);
    this.hint.alpha = 0;
    this.view.addChild(this.ring, this.flash, this.hint);
  }

  /**
   * Painting, then a scrim: the panels are translucent by design, so the art
   * under them has to be knocked back before any text lands on it.
   */
  private async buildBackdrop(): Promise<void> {
    const scrim = new Graphics()
      .rect(0, 0, VIRTUAL_WIDTH, VIRTUAL_HEIGHT)
      .fill({ color: 0x05060f, alpha: 0.46 });
    this.view.addChildAt(scrim, 0);

    const texture = await Assets.load<Texture>(BACKDROP_URL).catch(() => null);
    // The scene can be torn down while the download is still in flight.
    if (this.disposed || this.view.destroyed) return;
    if (!texture) return;

    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5);
    sprite.position.set(CENTER_X, VIRTUAL_HEIGHT / 2);
    // Cover: fill both axes and crop the overhang, never letterbox.
    sprite.scale.set(
      Math.max(VIRTUAL_WIDTH / texture.width, VIRTUAL_HEIGHT / texture.height) *
        BACKDROP_OVERSCAN,
    );
    this.view.addChildAt(sprite, 0);
  }

  private buildSolo(): void {
    const grade = this.results.grade;
    const tint = GRADE_TINT[grade] ?? 0xffffff;

    this.stamp = this.gradeStamp(
      GRADE_TITLE[grade] ?? grade,
      `RANK ${grade}`,
      88,
      tint,
    );
    this.stamp.position.set(CENTER_X, STAMP_Y);
    this.view.addChild(this.stamp);

    this.reveal.addChild(
      // A grade means nothing without the difficulty it was earned on.
      neonText(
        this.difficultyLabel.toUpperCase(),
        CENTER_X,
        DIFFICULTY_Y,
        neonStyle(PANEL_VIOLET, {
          fontSize: 28,
          fontWeight: "700",
          letterSpacing: 8,
        }),
      ),
      neonRule(CENTER_X, RULE_Y, 520, tint),
    );

    const row = 3 * CARD_WIDTH + 2 * CARD_GAP;
    const stats: readonly [string, number, (v: number) => string][] = [
      ["SCORE", this.results.score, wholeNumber],
      ["ACCURACY", this.results.accuracy * 100, percent],
      ["MAX COMBO", this.results.maxCombo, wholeNumber],
    ];
    stats.forEach(([label, value, format], i) => {
      const { card, valueText } = this.statCard(label, CARD_ACCENT[i]);
      card.position.set(
        (VIRTUAL_WIDTH - row) / 2 + i * (CARD_WIDTH + CARD_GAP),
        CARD_TOP,
      );
      this.reveal.addChild(card);
      this.enroll(new NumberRoll(valueText, format), value);
    });

    this.reveal.addChild(this.tally(TALLY_Y));
    if (this.character) void this.buildAvatar(grade);
  }

  /** Seed a readout at zero and queue its count-up for the impact. */
  private enroll(roll: NumberRoll, value: number): void {
    roll.snapTo(0);
    this.rolls.push(roll);
    this.pending.push({ roll, value });
  }

  /**
   * The grade, built as one block so the whole thing can be scaled about the
   * word's centre when it lands.
   */
  private gradeStamp(
    word: string,
    rank: string,
    size: number,
    tint: number,
  ): Container {
    const block = new Container();
    const main = neonText(
      word,
      0,
      0,
      neonStyle(tint, {
        fontSize: size,
        letterSpacing: 8,
        stroke: { color: tint, width: 4 },
        dropShadow: { color: tint, blur: 26, distance: 0, angle: 0, alpha: 1 },
      }),
    );
    const gloss = new Text({
      text: rank,
      style: neonStyle(tint, {
        fontSize: Math.round(size * 0.3),
        fontWeight: "700",
        letterSpacing: 4,
        fill: tint,
        stroke: { color: tint, width: 0 },
        dropShadow: {
          color: tint,
          blur: 12,
          distance: 0,
          angle: 0,
          alpha: 0.9,
        },
      }),
    });
    gloss.anchor.set(0, 0.5);
    gloss.position.set(main.width / 2 + 16, size * 0.22);
    block.addChild(main, gloss);
    return block;
  }

  /** One stat panel in the menus' style: caption, accent ring, big readout. */
  private statCard(
    label: string,
    accent: number,
  ): { card: Container; valueText: Text } {
    const card = new Container();
    const panel = new Graphics();
    drawPanel(panel, CARD_WIDTH, CARD_HEIGHT);
    const ring = new Graphics();
    drawAccentRing(ring, CARD_WIDTH, CARD_HEIGHT, accent, 0.85);

    const valueText = neonText(
      "0",
      CARD_WIDTH / 2,
      70,
      neonStyle(accent, { fontSize: 46, letterSpacing: 2 }),
    );
    card.addChild(
      panel,
      ring,
      neonText(label, CARD_WIDTH / 2, 30, flatStyle(accent, 18, 5)),
      valueText,
    );
    return { card, valueText };
  }

  /**
   * Judgement tally, each count in the colour that judgement wore during the
   * run (feedback.ts) — the one place the player can compare all four at once,
   * so it has to use the palette they were just taught.
   *
   * Laid out from the final figures and then rewound to zero: every count grows
   * from the centre of space it already reserved, so a three-digit miss count
   * can't shove the row sideways while it climbs.
   */
  private tally(y: number): Container {
    const c = this.results.counts;
    const entries: readonly [string, number, number][] = [
      ["perfect", c.perfect, TIER_COLOR.perfect],
      ["great", c.great, TIER_COLOR.great],
      ["good", c.good, TIER_COLOR.good],
      ["miss", c.miss, TIER_COLOR.miss],
    ];

    const items: { text: Text; count?: number }[] = [];
    entries.forEach(([label, count, tint], i) => {
      if (i > 0) {
        items.push({
          text: new Text({ text: "·", style: flatStyle(PANEL_VIOLET, 24, 0) }),
        });
      }
      items.push({
        text: new Text({ text: label, style: flatStyle(tint, 24, 2) }),
      });
      items.push({
        text: new Text({
          text: String(count),
          style: neonStyle(tint, {
            fontSize: 24,
            fontWeight: "700",
            letterSpacing: 2,
          }),
        }),
        count,
      });
    });

    const row = new Container();
    const gap = 10;
    const total =
      items.reduce((sum, it) => sum + it.text.width, 0) +
      gap * (items.length - 1);
    let x = CENTER_X - total / 2;
    for (const item of items) {
      const width = item.text.width;
      item.text.anchor.set(0.5);
      item.text.position.set(x + width / 2, y);
      row.addChild(item.text);
      x += width + gap;
      if (item.count !== undefined) {
        this.enroll(new NumberRoll(item.text, wholeNumber), item.count);
      }
    }
    return row;
  }

  /**
   * The played character, cropped by the bottom-right corner the way a curtain
   * call leaves them half off stage.
   */
  private async buildAvatar(grade: string): Promise<void> {
    const character = this.character;
    if (!character) return;
    const url = character.poses[GRADE_POSE[grade] ?? "idle"];
    const texture = await Assets.load<Texture>(url).catch(() => null);
    if (this.disposed || this.view.destroyed || !texture) return;

    const sprite = new Sprite(texture);
    sprite.anchor.set(1, 1);
    sprite.scale.set(330 / character.sourceSize.h);
    sprite.position.set(VIRTUAL_WIDTH - 6, VIRTUAL_HEIGHT + 18);
    this.reveal.addChild(sprite);
  }

  /** "press Enter for lobby" on a menu panel, with Enter drawn as a key cap. */
  private buildHint(y: number): Container {
    const wrap = new Container();
    const pre = new Text({
      text: "press",
      style: flatStyle(PANEL_VIOLET, 21, 3),
    });
    const key = new Text({
      text: "Enter",
      style: neonStyle(0x35f0ff, {
        fontSize: 21,
        fontWeight: "700",
        letterSpacing: 3,
        stroke: { color: 0x35f0ff, width: 1 },
      }),
    });
    const post = new Text({
      text: "for lobby",
      style: flatStyle(PANEL_VIOLET, 21, 3),
    });
    for (const t of [pre, key, post]) t.anchor.set(0, 0.5);

    const keyPadX = 12;
    const keyWidth = key.width + keyPadX * 2;
    const gap = 12;
    const content = pre.width + gap + keyWidth + gap + post.width;
    const width = content + 88;
    const height = 54;

    const panel = new Graphics();
    drawPanel(panel, width, height);
    panel.position.set(-width / 2, -height / 2);
    wrap.addChild(panel);

    let x = -content / 2;
    pre.position.set(x, 0);
    x += pre.width + gap;
    const cap = new Graphics()
      .roundRect(x, -15, keyWidth, 30, 6)
      .fill({ color: 0x120c22, alpha: 0.95 })
      .stroke({ color: 0x35f0ff, width: 1, alpha: 0.8 });
    key.position.set(x + keyPadX, 0);
    x += keyWidth + gap;
    post.position.set(x, 0);

    wrap.addChild(pre, cap, key, post);
    wrap.position.set(CENTER_X, y);
    return wrap;
  }

  private buildVersus(): void {
    const leftX = VIRTUAL_WIDTH * 0.27;
    const rightX = VIRTUAL_WIDTH * 0.73;
    const r = this.results;

    // The verdict can only be written once their result lands, so the stamp is
    // the player's own grade: something definite to land on now.
    this.stamp = this.gradeStamp(
      GRADE_TITLE[r.grade] ?? r.grade,
      `RANK ${r.grade}`,
      VS_GRADE_SIZE,
      GRADE_TINT[r.grade] ?? 0xffffff,
    );
    this.stamp.position.set(leftX, VS_GRADE_Y);
    this.view.addChild(this.stamp);

    this.verdictText = neonText(
      "",
      CENTER_X,
      82,
      neonStyle(VERDICT_TINT.win, { fontSize: 52, letterSpacing: 8 }),
    );

    this.ownStats = new ColumnStats();
    this.ownStats.position.set(leftX - ColumnStats.WIDTH / 2, VS_STATS_Y);
    this.opponentStats = new ColumnStats();
    this.opponentStats.position.set(rightX - ColumnStats.WIDTH / 2, VS_STATS_Y);

    // Under the panel, not over it: the note is the only line that changes once
    // their result lands, so it needs its own row.
    this.opponentNote = neonText(
      "waiting for opponent…",
      rightX,
      VS_STATS_Y + ColumnStats.height() + 28,
      flatStyle(PANEL_VIOLET, 20, 1),
    );
    // Mirrors the player's grade slot — same size and place — so the columns
    // stay symmetric while their result is still in flight.
    this.opponentGrade = neonText(
      "–",
      rightX,
      VS_GRADE_Y,
      flatStyle(0x6a5a9c, VS_GRADE_SIZE, 6),
    );
    this.opponentDifficulty = neonText(
      "",
      rightX,
      VS_DIFF_Y,
      flatStyle(PANEL_VIOLET, 20, 6),
    );

    const name = (text: string, x: number): Text =>
      neonText(
        text,
        x,
        VS_NAME_Y,
        neonStyle(0x35f0ff, { fontSize: 24, letterSpacing: 8 }),
      );

    this.reveal.addChild(
      this.verdictText,
      neonRule(CENTER_X, 128, 420, 0x35f0ff),
      name("YOU", leftX),
      // Difficulty under each name: players pick independently, so a column of
      // numbers without it invites a false comparison.
      neonText(
        this.difficultyLabel.toUpperCase(),
        leftX,
        VS_DIFF_Y,
        flatStyle(PANEL_VIOLET, 20, 6),
      ),
      this.ownStats,
      name(this.opponentName(), rightX),
      this.opponentGrade,
      this.opponentDifficulty,
      this.opponentStats,
      this.opponentNote,
    );
    for (const { roll, value } of this.ownStats.enroll(
      r.score,
      r.accuracy,
      r.maxCombo,
    )) {
      this.enroll(roll, value);
    }

    // Their finish may already have arrived while we were still playing.
    const existing = this.room?.peers[0]?.finish;
    if (existing) this.applyOpponent(existing);
    this.subscribe();
  }

  private opponentName(): string {
    return (this.room?.peers[0]?.name ?? "OPPONENT").toUpperCase();
  }

  private subscribe(): void {
    const room = this.room;
    if (!room) return;
    this.unsubscribes.push(
      room.bus.on("finish", ({ msg }) => {
        this.applyOpponent(msg);
      }),
      room.bus.on("peers", (peers) => {
        if (peers.length === 0 && this.opponentNote && !this.verdictSet) {
          this.opponentNote.text = "opponent left";
        }
      }),
    );
  }

  private verdictSet = false;

  private applyOpponent(msg: FinishMsg): void {
    // Their numbers count up the same way ours did, from whenever they arrive.
    this.opponentStats?.rollTo(msg.score, msg.accuracy, msg.maxCombo, ROLL_MS);
    if (this.opponentNote) this.opponentNote.visible = false;
    const grade = gradeFor(msg.accuracy);
    if (this.opponentGrade) {
      this.opponentGrade.text = GRADE_TITLE[grade] ?? grade;
      this.opponentGrade.style = neonStyle(GRADE_TINT[grade] ?? 0xffffff, {
        fontSize: VS_GRADE_SIZE,
        letterSpacing: 6,
      });
    }
    const theirDifficulty = difficultyLabel(msg.difficulty);
    if (this.opponentDifficulty) {
      this.opponentDifficulty.text = theirDifficulty.toUpperCase();
    }
    if (!this.verdictText) return;

    // Raw score isn't comparable across difficulties — a hard chart pays more
    // per note — so a mixed room is judged on accuracy, and says so rather
    // than quietly changing the rules.
    const sameDifficulty = theirDifficulty === this.difficultyLabel;
    const mine = sameDifficulty ? this.results.score : this.results.accuracy;
    const theirs = sameDifficulty ? msg.score : msg.accuracy;
    const outcome = mine > theirs ? "win" : mine < theirs ? "lose" : "tie";
    const suffix = sameDifficulty ? "" : " (ON ACCURACY)";
    const label =
      outcome === "win" ? "YOU WIN" : outcome === "lose" ? "YOU LOSE" : "TIE";
    this.verdictText.text = `${label}${suffix}`;
    this.verdictText.style = neonStyle(VERDICT_TINT[outcome], {
      fontSize: 52,
      letterSpacing: 8,
    });
    // The verdict lands like the grade did — same kick, so both halves of the
    // screen speak the same language.
    this.verdictAgeMs = 0;
    this.shakeAgeMs = 0;
    this.verdictSet = true;
  }

  /** The stamp has landed: kick the camera, throw the ring, start the counts. */
  private impact(): void {
    this.impactAgeMs = 0;
    this.shakeAgeMs = 0;
    this.ring.visible = true;
    for (const { roll, value } of this.pending) roll.rollTo(value, ROLL_MS);
    this.pending.length = 0;
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Enter") this.onDone();
  };

  enter(): void {
    window.addEventListener("keydown", this.onKeyDown);
  }

  exit(): void {
    this.disposed = true;
    window.removeEventListener("keydown", this.onKeyDown);
    for (const off of this.unsubscribes) off();
    this.unsubscribes.length = 0;
  }

  update(ticker: Ticker): void {
    const dt = ticker.deltaMS;
    this.ageMs += dt;

    this.updateStamp();
    if (this.impactAgeMs >= 0) {
      this.impactAgeMs += dt;
      this.updateImpact();
      this.updateReveal();
    }
    this.updateVerdict(dt);
    this.updateShake(dt);
    for (const roll of this.rolls) roll.update(dt);
    this.opponentStats?.update(dt);
  }

  /**
   * The drop: a big, tilted, transparent grade rushing down to full size, then
   * one frame where it is exactly right — that frame is the impact.
   */
  private updateStamp(): void {
    const stamp = this.stamp;
    if (!stamp) return;
    if (this.ageMs < STAMP_DELAY_MS) {
      stamp.alpha = 0;
      return;
    }
    if (this.impactAgeMs >= 0) return; // landed; nothing left to animate

    const t = Math.min(1, (this.ageMs - STAMP_DELAY_MS) / STAMP_TRAVEL_MS);
    // Cubic ease-out: most of the travel happens in the first third, so the
    // last stretch reads as the stamp being pressed home.
    const eased = 1 - (1 - t) ** 3;
    stamp.scale.set(STAMP_START_SCALE + (1 - STAMP_START_SCALE) * eased);
    stamp.rotation = STAMP_START_TILT * (1 - eased);
    stamp.alpha = Math.min(1, t * 2.4);
    if (t < 1) return;

    stamp.scale.set(1);
    stamp.rotation = 0;
    stamp.alpha = 1;
    this.impact();
  }

  /** Impact debris: a white flash and a ring thrown out from the grade. */
  private updateImpact(): void {
    const flash = 1 - Math.min(1, this.impactAgeMs / IMPACT_FLASH_MS);
    this.flash.alpha = 0.22 * flash ** 2;

    if (!this.ring.visible) return;
    const t = this.impactAgeMs / IMPACT_RING_MS;
    if (t >= 1) {
      this.ring.visible = false;
      this.ring.clear();
      return;
    }
    const tint = GRADE_TINT[this.results.grade] ?? 0xffffff;
    this.ring
      .clear()
      .circle(this.stamp?.x ?? CENTER_X, this.stamp?.y ?? STAMP_Y, 60 + t * 340)
      .stroke({ color: tint, width: 6 * (1 - t), alpha: 0.7 * (1 - t) ** 2 });
  }

  /** Panels and numbers fade up out of the impact, never before it. */
  private updateReveal(): void {
    this.reveal.alpha = Math.min(1, this.impactAgeMs / REVEAL_FADE_MS);

    // The hint waits for the counting to finish: it is the next instruction,
    // and it shouldn't compete with the numbers for attention.
    const settled = this.impactAgeMs - ROLL_MS;
    if (settled <= 0) {
      this.hint.alpha = 0;
    } else if (settled < HINT_FADE_MS) {
      this.hint.alpha = settled / HINT_FADE_MS;
    } else {
      // Once shown, the hint breathes the way the title screen's does.
      this.hint.alpha = 0.72 + 0.28 * Math.sin((settled - HINT_FADE_MS) / 420);
    }
  }

  /** Verdict pop: overshoot and settle, so the result arriving is felt. */
  private updateVerdict(dt: number): void {
    if (this.verdictAgeMs === Infinity || !this.verdictText) return;
    this.verdictAgeMs += dt;
    const t = Math.min(1, this.verdictAgeMs / 180);
    this.verdictText.scale.set(1.5 - 0.5 * (1 - (1 - t) ** 3));
    if (t >= 1) {
      this.verdictText.scale.set(1);
      this.verdictAgeMs = Infinity;
    }
  }

  /**
   * Camera shake: the scene's whole view is offset, so painting, panels and
   * grade kick together. Short and dry — one struck object, not a streak.
   */
  private updateShake(dt: number): void {
    if (this.shakeAgeMs >= IMPACT_SHAKE_MS) return;
    this.shakeAgeMs += dt;
    if (this.shakeAgeMs >= IMPACT_SHAKE_MS) {
      this.view.position.set(0, 0);
      return;
    }
    const { x, y } = shakeOffset(this.shakeAgeMs, IMPACT_SHAKE_MS);
    this.view.position.set(x, y);
  }
}

const wholeNumber = (value: number): string => String(Math.round(value));
const percent = (value: number): string => `${value.toFixed(1)}%`;

/**
 * Neon's quieter register: the colour itself carries the text, with the glow but
 * no white core. For captions and labels, which shouldn't shout over the numbers
 * they belong to.
 */
function flatStyle(color: number, fontSize: number, letterSpacing: number) {
  return neonStyle(color, {
    fontSize,
    fontWeight: "700",
    letterSpacing,
    fill: color,
    stroke: { color, width: 0 },
  });
}

/** Thin glowing rule: the menus' divider, and the stamp's landing line. */
function neonRule(
  centerX: number,
  y: number,
  width: number,
  color: number,
): Graphics {
  const g = new Graphics()
    // Wide soft bed under a hairline core: two passes are all a glowing line
    // needs, and it stays cheap.
    .rect(centerX - width / 2, y - 5, width, 10)
    .fill({ color, alpha: 0.1 })
    .rect(centerX - width / 2, y - 1, width, 2)
    .fill({ color, alpha: 0.75 });
  g.blendMode = "add";
  return g;
}

/**
 * A versus column's three numbers in one panel: label left, value right, so the
 * two columns' values line up for comparison across the gap.
 */
class ColumnStats extends Container {
  static readonly WIDTH = 340;
  private static readonly LABELS = ["SCORE", "ACCURACY", "MAX COMBO"];
  private static readonly ROW_HEIGHT = 46;
  private static readonly PAD = 22;

  /** Panel height, so callers can place a row beneath it. */
  static height(): number {
    return (
      ColumnStats.LABELS.length * ColumnStats.ROW_HEIGHT +
      ColumnStats.PAD * 2 -
      10
    );
  }

  private readonly rolls: NumberRoll[] = [];

  constructor() {
    super();
    const panel = new Graphics();
    drawPanel(panel, ColumnStats.WIDTH, ColumnStats.height());
    this.addChild(panel);

    ColumnStats.LABELS.forEach((label, i) => {
      const accent = CARD_ACCENT[i];
      const y = ColumnStats.PAD + i * ColumnStats.ROW_HEIGHT + 12;

      const caption = new Text({
        text: label,
        style: flatStyle(accent, 17, 4),
      });
      caption.anchor.set(0, 0.5);
      caption.position.set(ColumnStats.PAD + 10, y);

      const value = new Text({
        text: "–",
        style: neonStyle(accent, { fontSize: 26, letterSpacing: 1 }),
      });
      value.anchor.set(1, 0.5);
      value.position.set(ColumnStats.WIDTH - ColumnStats.PAD - 10, y);

      this.rolls.push(new NumberRoll(value, i === 1 ? percent : wholeNumber));
      this.addChild(caption, value);
      if (i > 0) {
        this.addChild(
          new Graphics()
            .rect(
              ColumnStats.PAD + 6,
              y - ColumnStats.ROW_HEIGHT / 2,
              ColumnStats.WIDTH - (ColumnStats.PAD + 6) * 2,
              1,
            )
            .fill({ color: 0x6f5cc8, alpha: 0.35 }),
        );
      }
    });
  }

  /** Hand this column's counts to the scene's stamp-triggered count-up. */
  enroll(score: number, accuracy: number, maxCombo: number): PendingRoll[] {
    const values = [score, accuracy * 100, maxCombo];
    return this.rolls.map((roll, i) => ({ roll, value: values[i] }));
  }

  /** Count up to a result that arrived on its own clock (the opponent's). */
  rollTo(
    score: number,
    accuracy: number,
    maxCombo: number,
    durationMs: number,
  ): void {
    const values = [score, accuracy * 100, maxCombo];
    this.rolls.forEach((roll, i) => {
      // From zero rather than from the placeholder dash, or the first frame of
      // the count jumps to wherever the previous number left off.
      roll.snapTo(0);
      roll.rollTo(values[i], durationMs);
    });
  }

  update(deltaMs: number): void {
    for (const roll of this.rolls) roll.update(deltaMs);
  }
}
