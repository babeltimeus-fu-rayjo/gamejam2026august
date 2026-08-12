import { Container, Graphics, GraphicsContext, Text, Ticker } from "pixi.js";
import { VIRTUAL_HEIGHT, VIRTUAL_WIDTH } from "../config";
import { LANE_KEY_LABELS } from "../core/input";
import type { JudgedNote } from "./judge";

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

// All note sprites share one GraphicsContext: one geometry on the GPU,
// cheap instances in the pool.
const NOTE_CONTEXT = new GraphicsContext()
  .roundRect(-NOTE_WIDTH / 2, -NOTE_HEIGHT / 2, NOTE_WIDTH, NOTE_HEIGHT, 10)
  .fill(0xff5c8a)
  .stroke({ width: 3, color: 0xffffff, alpha: 0.35 });

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
  private readonly pool: Graphics[] = [];
  private readonly active = new Map<JudgedNote, Graphics>();
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
    g.rect(TRACK_LEFT, HIT_Y, TRACK_WIDTH, 4).fill(0xff5c8a);
    this.view.addChild(g, this.notesLayer);

    for (let lane = 0; lane < 4; lane++) {
      const cx = laneCenterX(lane);
      const box = new Graphics()
        .roundRect(cx - 26, HIT_Y + 24, 52, 52, 8)
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
      label.position.set(cx, HIT_Y + 50);
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
      sprite = new Graphics(NOTE_CONTEXT);
      this.notesLayer.addChild(sprite);
    }
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
