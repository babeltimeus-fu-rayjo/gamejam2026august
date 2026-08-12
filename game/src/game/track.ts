import { Container, Graphics, GraphicsContext, Text, Ticker } from "pixi.js";
import { VIRTUAL_HEIGHT, VIRTUAL_WIDTH } from "../config";
import { LANE_KEY_LABELS } from "../core/input";
import type { JudgedNote } from "./judge";

// Track geometry — the semi-transparent band over the art layer.
export const TRACK_TOP = VIRTUAL_HEIGHT * 0.6;
export const LANE_HEIGHT = (VIRTUAL_HEIGHT - TRACK_TOP) / 4;
export const HIT_X = VIRTUAL_WIDTH - 150;
/** Note travel speed, px per second of song time. */
export const SCROLL_SPEED = 600;
export const NOTE_SIZE = 46;

const RECEPTOR_IDLE_ALPHA = 0.55;

// All note sprites share one GraphicsContext: one geometry on the GPU,
// cheap instances in the pool.
const NOTE_CONTEXT = new GraphicsContext()
  .roundRect(-NOTE_SIZE / 2, -NOTE_SIZE / 2, NOTE_SIZE, NOTE_SIZE, 10)
  .fill(0xff5c8a)
  .stroke({ width: 3, color: 0xffffff, alpha: 0.35 });

function laneCenterY(lane: number): number {
  return TRACK_TOP + (lane + 0.5) * LANE_HEIGHT;
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
  private readonly pool: Graphics[] = [];
  private readonly active = new Map<JudgedNote, Graphics>();
  /** Index into the (sorted) note list of the next note to spawn. */
  private spawnCursor = 0;

  constructor() {
    const g = new Graphics();
    for (let lane = 0; lane < 4; lane++) {
      const y = TRACK_TOP + lane * LANE_HEIGHT;
      g.rect(0, y, VIRTUAL_WIDTH, LANE_HEIGHT).fill({
        color: lane % 2 === 0 ? 0x181226 : 0x1d1630,
        alpha: 0.6,
      });
    }
    g.rect(0, TRACK_TOP - 2, VIRTUAL_WIDTH, 2).fill(0x3a2f5c);
    g.rect(HIT_X, TRACK_TOP, 4, VIRTUAL_HEIGHT - TRACK_TOP).fill(0xff5c8a);
    this.view.addChild(g, this.notesLayer);

    for (let lane = 0; lane < 4; lane++) {
      const cy = laneCenterY(lane);
      const box = new Graphics()
        .roundRect(HIT_X + 24, cy - 26, 52, 52, 8)
        .stroke({ width: 3, color: 0x8f7bd8 });
      box.alpha = RECEPTOR_IDLE_ALPHA;
      this.receptors.push(box);
      const label = new Text({
        text: LANE_KEY_LABELS[lane],
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
  }

  flash(lane: number): void {
    this.receptors[lane].alpha = 1;
  }

  update(ticker: Ticker): void {
    for (const receptor of this.receptors) {
      receptor.alpha = Math.max(
        RECEPTOR_IDLE_ALPHA,
        receptor.alpha - ticker.deltaMS / 200,
      );
    }
  }

  /**
   * Spawn sprites for notes entering the look-ahead window, position open
   * notes, and pool sprites of judged notes. `notes` must be sorted by t
   * (parseChart guarantees it).
   */
  sync(notes: readonly JudgedNote[], songTime: number): void {
    const lookAhead = (HIT_X + NOTE_SIZE) / SCROLL_SPEED;
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
      sprite.x = HIT_X - (note.t - songTime) * SCROLL_SPEED;
    }
  }

  private acquire(note: JudgedNote): void {
    let sprite = this.pool.pop();
    if (!sprite) {
      sprite = new Graphics(NOTE_CONTEXT);
      this.notesLayer.addChild(sprite);
    }
    sprite.visible = true;
    sprite.x = -NOTE_SIZE;
    sprite.y = laneCenterY(note.lane);
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
