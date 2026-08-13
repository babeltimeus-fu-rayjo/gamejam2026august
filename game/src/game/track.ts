import {
  Container,
  FillGradient,
  Graphics,
  GraphicsContext,
  Text,
  Ticker,
} from "pixi.js";
import { VIRTUAL_HEIGHT, VIRTUAL_WIDTH } from "../config";
import { LANE_KEY_LABELS } from "../core/input";
import type { JudgedNote, Judgement } from "./judge";

// Track geometry — a vertical, semi-transparent band over the art layer.
// Notes fall from the top of the screen down into the hit line.
export const LANE_WIDTH = 100;
export const TRACK_WIDTH = LANE_WIDTH * 4;
export const TRACK_LEFT = Math.round((VIRTUAL_WIDTH - TRACK_WIDTH) / 2);
export const HIT_Y = VIRTUAL_HEIGHT - 150;
/** Note travel speed, px per second of song time. */
export const SCROLL_SPEED = 600;
export const NOTE_WIDTH = LANE_WIDTH - 24;
export const NOTE_HEIGHT = 30;

const RECEPTOR_IDLE_ALPHA = 0.55;

// Per-lane palette (D F J K) shared by notes, receptors, and key labels:
// dusty, desaturated arcane-ish tones — rose, amethyst, jade, antique
// gold — so lanes read apart without going neon on the dark backdrop.
// `label` is the same hue lifted toward white for text legibility.
const LANE_COLORS = [
  { note: 0xc9708e, label: 0xe3b3c4 }, // dusty rose
  { note: 0x9678c8, label: 0xc7b4e6 }, // muted amethyst
  { note: 0x7cb583, label: 0xb9d9bd }, // sage jade
  { note: 0xc7a763, label: 0xe3d0a4 }, // antique gold
] as const;

// One shared GraphicsContext per lane: four geometries on the GPU total,
// cheap instances in the pool. acquire() swaps a sprite's context to match
// its note's lane, so the pool stays lane-agnostic.
const NOTE_CONTEXTS = LANE_COLORS.map(({ note }) =>
  new GraphicsContext()
    .roundRect(-NOTE_WIDTH / 2, -NOTE_HEIGHT / 2, NOTE_WIDTH, NOTE_HEIGHT, 10)
    .fill(note)
    .stroke({ width: 3, color: 0xffffff, alpha: 0.35 }),
);

// Hit burst — when a note is keyed in time it flashes bright at the hit
// line, blooms outward, and fades. White geometry tinted with the lane's
// light variant + additive blend reads as light, not paint, and stays in
// the muted palette. Intensity scales with judgement quality; misses get
// nothing.
const BURST_DURATION_MS = 280;
const BURST_MAX_SCALE = 1.55;
const BURST_INTENSITY: Readonly<Record<Judgement, number>> = {
  perfect: 1,
  great: 0.75,
  good: 0.5,
  miss: 0,
};
const BURST_CONTEXT = new GraphicsContext()
  .roundRect(-NOTE_WIDTH / 2, -NOTE_HEIGHT / 2, NOTE_WIDTH, NOTE_HEIGHT, 10)
  .fill(0xffffff);

interface Burst {
  sprite: Graphics;
  ageMs: number;
  intensity: number;
}

// Hit glow — a purple gradient sheet rising from the beat line on every
// keyed note, strongest at the line and transparent at its top edge.
// Capped at half the screen height by design.
const GLOW_HEIGHT = VIRTUAL_HEIGHT * 0.5;
const GLOW_DURATION_MS = 420;
const GLOW_PEAK_ALPHA = 0.9;

function laneCenterX(lane: number): number {
  return TRACK_LEFT + (lane + 0.5) * LANE_WIDTH;
}

/**
 * Renders the 4-lane track: lane strips, hit line, receptors, and pooled
 * note sprites positioned as a pure function of song time. Owns no game
 * state — notes' judgement fields drive sprite lifecycle.
 */
export class Track {
  readonly view = new Container();

  private readonly receptors: Graphics[] = [];
  private readonly notesLayer = new Container();
  private readonly burstLayer = new Container();
  private readonly pool: Graphics[] = [];
  private readonly burstPool: Graphics[] = [];
  private readonly bursts: Burst[] = [];
  private readonly active = new Map<JudgedNote, Graphics>();
  private readonly glow: Graphics;
  /** 0..1; jumps on a hit, decays linearly, drives the glow alpha. */
  private glowStrength = 0;
  /** Index into the (sorted) note list of the next note to spawn. */
  private spawnCursor = 0;

  constructor() {
    const g = new Graphics();
    for (let lane = 0; lane < 4; lane++) {
      const x = TRACK_LEFT + lane * LANE_WIDTH;
      g.rect(x, 0, LANE_WIDTH, VIRTUAL_HEIGHT).fill({
        color: lane % 2 === 0 ? 0x181226 : 0x1d1630,
        alpha: 0.6,
      });
    }
    g.rect(TRACK_LEFT - 2, 0, 2, VIRTUAL_HEIGHT).fill(0x3a2f5c);
    g.rect(TRACK_LEFT + TRACK_WIDTH, 0, 2, VIRTUAL_HEIGHT).fill(0x3a2f5c);
    g.rect(TRACK_LEFT, HIT_Y, TRACK_WIDTH, 4).fill(0xbfb3e0);

    // Amethyst, fading to nothing at the top; alpha is animated per hit.
    const glowGradient = new FillGradient({
      start: { x: 0, y: 1 },
      end: { x: 0, y: 0 },
      colorStops: [
        { offset: 0, color: "rgba(150, 120, 200, 0.55)" },
        { offset: 1, color: "rgba(150, 120, 200, 0)" },
      ],
    });
    this.glow = new Graphics()
      .rect(TRACK_LEFT, HIT_Y - GLOW_HEIGHT, TRACK_WIDTH, GLOW_HEIGHT)
      .fill(glowGradient);
    this.glow.blendMode = "add";
    this.glow.alpha = 0;

    // Glow sits behind notes so rising light never obscures gameplay.
    this.view.addChild(g, this.glow, this.notesLayer, this.burstLayer);

    for (let lane = 0; lane < 4; lane++) {
      const cx = laneCenterX(lane);
      const box = new Graphics()
        .roundRect(cx - 26, HIT_Y + 24, 52, 52, 8)
        .stroke({ width: 3, color: LANE_COLORS[lane].note });
      box.alpha = RECEPTOR_IDLE_ALPHA;
      this.receptors.push(box);
      const label = new Text({
        text: LANE_KEY_LABELS[lane],
        style: {
          fontFamily: "Arial",
          fontSize: 28,
          fontWeight: "700",
          fill: LANE_COLORS[lane].label,
        },
      });
      label.anchor.set(0.5);
      label.position.set(cx, HIT_Y + 50);
      this.view.addChild(box, label);
    }
  }

  flash(lane: number): void {
    this.receptors[lane].alpha = 1;
  }

  /** Flash-and-bloom at the hit line for a note keyed in time. */
  hitBurst(lane: number, judgement: Judgement): void {
    const intensity = BURST_INTENSITY[judgement];
    if (intensity <= 0) return;
    let sprite = this.burstPool.pop();
    if (!sprite) {
      sprite = new Graphics(BURST_CONTEXT);
      sprite.blendMode = "add";
      this.burstLayer.addChild(sprite);
    }
    sprite.tint = LANE_COLORS[lane].label;
    sprite.position.set(laneCenterX(lane), HIT_Y);
    sprite.scale.set(1);
    sprite.alpha = intensity;
    sprite.visible = true;
    this.bursts.push({ sprite, ageMs: 0, intensity });

    this.glowStrength = Math.max(this.glowStrength, intensity);
    this.glow.alpha = GLOW_PEAK_ALPHA * this.glowStrength ** 2;
  }

  update(ticker: Ticker): void {
    for (const receptor of this.receptors) {
      receptor.alpha = Math.max(
        RECEPTOR_IDLE_ALPHA,
        receptor.alpha - ticker.deltaMS / 200,
      );
    }

    if (this.glowStrength > 0) {
      this.glowStrength = Math.max(
        0,
        this.glowStrength - ticker.deltaMS / GLOW_DURATION_MS,
      );
      // Squared: bright arrival, gentle tail.
      this.glow.alpha = GLOW_PEAK_ALPHA * this.glowStrength ** 2;
    }

    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const burst = this.bursts[i];
      burst.ageMs += ticker.deltaMS;
      const p = burst.ageMs / BURST_DURATION_MS;
      if (p >= 1) {
        burst.sprite.visible = false;
        this.burstPool.push(burst.sprite);
        this.bursts.splice(i, 1);
        continue;
      }
      const fade = (1 - p) ** 2; // starts at full flash, eases out
      burst.sprite.alpha = burst.intensity * fade;
      burst.sprite.scale.set(
        1 + (BURST_MAX_SCALE - 1) * (1 - fade) * burst.intensity,
      );
    }
  }

  /**
   * Spawn sprites for notes entering the look-ahead window, position open
   * notes, and pool sprites of judged notes. `notes` must be sorted by t
   * (parseChart guarantees it).
   */
  sync(notes: readonly JudgedNote[], songTime: number): void {
    const lookAhead = (HIT_Y + NOTE_HEIGHT) / SCROLL_SPEED;
    while (
      this.spawnCursor < notes.length &&
      notes[this.spawnCursor].t <= songTime + lookAhead
    ) {
      const note = notes[this.spawnCursor];
      this.spawnCursor += 1;
      if (note.judgement === null) this.acquire(note);
    }

    for (const [note, sprite] of this.active) {
      if (note.judgement !== null) {
        this.release(note);
        continue;
      }
      sprite.y = HIT_Y - (note.t - songTime) * SCROLL_SPEED;
    }
  }

  private acquire(note: JudgedNote): void {
    let sprite = this.pool.pop();
    if (!sprite) {
      sprite = new Graphics(NOTE_CONTEXTS[note.lane]);
      this.notesLayer.addChild(sprite);
    }
    sprite.context = NOTE_CONTEXTS[note.lane];
    sprite.visible = true;
    sprite.x = laneCenterX(note.lane);
    sprite.y = -NOTE_HEIGHT;
    this.active.set(note, sprite);
  }

  private release(note: JudgedNote): void {
    const sprite = this.active.get(note);
    if (!sprite) return;
    sprite.visible = false;
    this.pool.push(sprite);
    this.active.delete(note);
  }
}
