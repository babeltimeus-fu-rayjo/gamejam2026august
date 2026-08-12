import { Container, Graphics, Text, Ticker } from "pixi.js";
import { VIRTUAL_HEIGHT, VIRTUAL_WIDTH } from "../config";
import { AudioClock } from "../core/clock";
import { LANE_KEY_LABELS, LaneInput } from "../core/input";
import { Judge, type JudgedNote } from "./judge";
import type { Scene } from "./scenes";

// Track layout (final look lands in M2; still wireframe-grade).
const TRACK_TOP = VIRTUAL_HEIGHT * 0.6;
const LANE_HEIGHT = (VIRTUAL_HEIGHT - TRACK_TOP) / 4;
const HIT_X = VIRTUAL_WIDTH - 150;
/** Note travel speed, px per second of song time. */
const SCROLL_SPEED = 600;
const NOTE_SIZE = 46;
const RECEPTOR_IDLE_ALPHA = 0.55;

const SONG_URL = `${import.meta.env.BASE_URL}songs/everyday-is-extraordinary/Everyday is extraordinary.mp3`;

// M1: hardcoded test pattern on lane 1 (F) — real charts load in M2.
function testNotes(): JudgedNote[] {
  const notes: JudgedNote[] = [];
  for (let i = 0; i < 20; i++) {
    notes.push({ t: 2 + i * 0.75, lane: 1, judgement: null });
  }
  return notes;
}

/**
 * M1 gameplay: plays the song through the AudioClock, scrolls a hardcoded
 * note pattern into the right-edge hit line as a pure function of
 * songTime(), and prints judgements to the console. Enter skips to
 * results; the scene auto-advances shortly after the pattern ends.
 */
export class GameplayScene implements Scene {
  readonly view = new Container();

  private readonly clock = new AudioClock();
  private readonly notes = testNotes();
  private readonly judge = new Judge(this.notes);
  private readonly input = new LaneInput((lane) => this.onLane(lane));

  private readonly noteSprites = new Map<JudgedNote, Graphics>();
  private readonly receptors: Graphics[] = [];
  private readonly status: Text;
  private doneForMs = 0;

  constructor(private readonly onFinish: () => void) {
    // Placeholder art layer: fills the screen BEHIND the semi-transparent
    // track. The real reactive stage (M4) replaces this; big soft shapes
    // are enough to prove the art shows through the lanes.
    const art = new Graphics()
      .circle(VIRTUAL_WIDTH * 0.3, VIRTUAL_HEIGHT * 0.35, 220)
      .fill({ color: 0x3a2f5c, alpha: 0.55 })
      .circle(VIRTUAL_WIDTH * 0.68, VIRTUAL_HEIGHT * 0.55, 300)
      .fill({ color: 0x24406b, alpha: 0.45 })
      .circle(VIRTUAL_WIDTH * 0.85, VIRTUAL_HEIGHT * 0.2, 140)
      .fill({ color: 0x5a2f4e, alpha: 0.55 });
    this.view.addChild(art);

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
    this.view.addChild(g);

    // Notes live in one container above the lanes, below the receptors.
    const notesLayer = new Container();
    for (const note of this.notes) {
      const sprite = new Graphics()
        .roundRect(-NOTE_SIZE / 2, -NOTE_SIZE / 2, NOTE_SIZE, NOTE_SIZE, 10)
        .fill(0xff5c8a)
        .stroke({ width: 3, color: 0xffffff, alpha: 0.35 });
      sprite.y = TRACK_TOP + (note.lane + 0.5) * LANE_HEIGHT;
      sprite.visible = false;
      notesLayer.addChild(sprite);
      this.noteSprites.set(note, sprite);
    }
    this.view.addChild(notesLayer);

    for (let lane = 0; lane < 4; lane++) {
      const cy = TRACK_TOP + (lane + 0.5) * LANE_HEIGHT;
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

    this.status = new Text({
      text: "loading song…",
      style: { fontFamily: "Arial", fontSize: 20, fill: 0x9f8fd8 },
    });
    this.status.position.set(24, TRACK_TOP - 40);

    this.view.addChild(this.status);
  }

  private onLane(lane: number): void {
    // Any lane key doubles as an audio unlock during the waiting state.
    void this.clock.resume();
    this.receptors[lane].alpha = 1;
    if (!this.clock.started) return;
    const hit = this.judge.tryHit(lane, this.clock.songTime());
    if (hit) {
      const ms = (hit.delta * 1000).toFixed(1);
      console.log(
        `[judge] ${hit.judgement.toUpperCase()} ${ms}ms (lane ${LANE_KEY_LABELS[lane]})`,
      );
      const sprite = this.noteSprites.get(hit.note);
      if (sprite) sprite.visible = false;
    } else {
      console.log(
        `[judge] tap lane ${LANE_KEY_LABELS[lane]} — no note in range`,
      );
    }
  }

  private readonly onAnyKey = (e: KeyboardEvent): void => {
    if (e.key === "Enter") {
      this.onFinish();
      return;
    }
    void this.clock.resume();
  };

  enter(): void {
    this.input.attach();
    window.addEventListener("keydown", this.onAnyKey);
    this.clock.load(SONG_URL).catch((err: unknown) => {
      this.setStatus(`audio failed to load: ${String(err)}`);
    });
    void this.clock.resume();
  }

  exit(): void {
    this.input.detach();
    window.removeEventListener("keydown", this.onAnyKey);
    this.clock.destroy();
  }

  private setStatus(text: string): void {
    // Canvas Text re-renders on every assignment; only touch it on change.
    if (this.status.text !== text) this.status.text = text;
  }

  update(ticker: Ticker): void {
    for (const receptor of this.receptors) {
      receptor.alpha = Math.max(
        RECEPTOR_IDLE_ALPHA,
        receptor.alpha - ticker.deltaMS / 200,
      );
    }

    if (!this.clock.loaded) return;
    if (!this.clock.running) {
      this.setStatus("press any key to enable audio");
      return;
    }
    if (!this.clock.started) {
      this.clock.start(1);
      // Metronome clicks at note times make clock/visual drift audible.
      for (const n of this.notes) this.clock.clickAt(n.t);
      this.setStatus("playing — hit F on the beat (Enter skips to results)");
    }

    const t = this.clock.songTime();

    for (const missed of this.judge.sweepMisses(t)) {
      console.log(
        `[judge] MISS (lane ${LANE_KEY_LABELS[missed.lane]}) t=${missed.t.toFixed(2)}`,
      );
    }

    let open = 0;
    for (const note of this.notes) {
      const sprite = this.noteSprites.get(note);
      if (!sprite) continue;
      if (note.judgement !== null) {
        sprite.visible = false;
        continue;
      }
      open++;
      const x = HIT_X - (note.t - t) * SCROLL_SPEED;
      sprite.x = x;
      sprite.visible = x > -NOTE_SIZE && x < VIRTUAL_WIDTH + NOTE_SIZE;
    }

    if (open === 0) {
      this.doneForMs += ticker.deltaMS;
      this.setStatus("test pattern done — heading to results…");
      if (this.doneForMs > 1500) this.onFinish();
    }
  }
}
