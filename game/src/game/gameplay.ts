import { Container, Graphics, Text, Ticker } from "pixi.js";
import { Avatar } from "../art/avatar";
import { TEAL } from "../art/characters";
import { VIRTUAL_HEIGHT, VIRTUAL_WIDTH } from "../config";
import { parseChart, type Chart } from "../core/beatmap";
import { AudioClock } from "../core/clock";
import { Emitter } from "../core/events";
import { LaneInput } from "../core/input";
import { Hud } from "../ui/hud";
import { Judge, type JudgedNote } from "./judge";
import { ScoreState, type GameEvents, type PlayResults } from "./score";
import { Track } from "./track";
import type { Scene } from "./scenes";

// Lobby track select lands in M5; until then gameplay loads this song.
const SONG_ID = "everyday-is-extraordinary";
const SONG_DIR = `${import.meta.env.BASE_URL}songs/${SONG_ID}/`;

/** Grace period after the last judged note before results. */
const OUTRO_S = 1.5;

// Top-left corner buttons (pause / back to lobby).
const BUTTON_HEIGHT = 40;
const BUTTON_WIDTH = 130;
const BUTTON_MARGIN = 20;
const BUTTON_GAP = 12;
const BUTTON_IDLE_ALPHA = 0.85;

/**
 * M2 gameplay: loads chart.json + audio, plays all four lanes with pooled
 * note sprites, applies scoring through the event bus (HUD subscribes),
 * and hands PlayResults to the results scene. Holds judge as taps until
 * the hold mechanic lands. Enter bails out early with partial results.
 */
export class GameplayScene implements Scene {
  readonly view = new Container();

  private readonly clock = new AudioClock();
  private readonly bus = new Emitter<GameEvents>();
  private readonly track = new Track();
  private readonly hud = new Hud(this.bus);
  // Player sits right of the track; a future multiplayer opponent takes
  // side: "left" with its own bus (see PLAN.md M4/M6).
  private readonly avatar = new Avatar({
    side: "right",
    character: TEAL,
    bus: this.bus,
  });
  private readonly input = new LaneInput((lane) => this.onLane(lane));
  private readonly status: Text;

  private readonly pauseLabel: Text;
  private readonly pauseOverlay: Container;

  private chart: Chart | null = null;
  private notes: JudgedNote[] = [];
  private judge: Judge | null = null;
  private score: ScoreState | null = null;
  private lastNoteT = 0;
  private finished = false;
  private paused = false;

  constructor(
    private readonly onFinish: (results: PlayResults) => void,
    private readonly onQuit: () => void,
  ) {
    // Placeholder art layer: fills the screen BEHIND the semi-transparent
    // track (real reactive stage lands in M4).
    const art = new Graphics()
      .circle(VIRTUAL_WIDTH * 0.3, VIRTUAL_HEIGHT * 0.35, 220)
      .fill({ color: 0x3a2f5c, alpha: 0.55 })
      .circle(VIRTUAL_WIDTH * 0.68, VIRTUAL_HEIGHT * 0.55, 300)
      .fill({ color: 0x24406b, alpha: 0.45 })
      .circle(VIRTUAL_WIDTH * 0.85, VIRTUAL_HEIGHT * 0.2, 140)
      .fill({ color: 0x5a2f4e, alpha: 0.55 });

    this.status = new Text({
      text: "loading chart…",
      style: { fontFamily: "Arial", fontSize: 20, fill: 0x9f8fd8 },
    });
    // Below the receptors, centered: the vertical track leaves no room for
    // a full-width status line beside it.
    this.status.anchor.set(0.5);
    this.status.position.set(VIRTUAL_WIDTH / 2, VIRTUAL_HEIGHT - 36);

    // Paused overlay: dims the whole screen; buttons stay on top of it.
    this.pauseOverlay = new Container();
    this.pauseOverlay.eventMode = "none";
    this.pauseOverlay.visible = false;
    const dim = new Graphics()
      .rect(0, 0, VIRTUAL_WIDTH, VIRTUAL_HEIGHT)
      .fill({ color: 0x0e0a1a, alpha: 0.65 });
    const pausedTitle = new Text({
      text: "PAUSED",
      style: {
        fontFamily: "Arial",
        fontSize: 64,
        fontWeight: "900",
        letterSpacing: 6,
        fill: 0xffffff,
      },
    });
    pausedTitle.anchor.set(0.5);
    pausedTitle.position.set(VIRTUAL_WIDTH / 2, VIRTUAL_HEIGHT * 0.42);
    const pausedHint = new Text({
      text: "click RESUME or press Esc",
      style: { fontFamily: "Arial", fontSize: 22, fill: 0x9f8fd8 },
    });
    pausedHint.anchor.set(0.5);
    pausedHint.position.set(VIRTUAL_WIDTH / 2, VIRTUAL_HEIGHT * 0.52);
    this.pauseOverlay.addChild(dim, pausedTitle, pausedHint);

    const pauseButton = this.makeButton("PAUSE", BUTTON_MARGIN, () =>
      this.togglePause(),
    );
    this.pauseLabel = pauseButton.label;
    const lobbyButton = this.makeButton(
      "< LOBBY",
      BUTTON_MARGIN + BUTTON_WIDTH + BUTTON_GAP,
      () => this.quit(),
    );

    this.view.addChild(
      art,
      this.avatar.view,
      this.track.view,
      this.hud.view,
      this.status,
      this.pauseOverlay,
      pauseButton.view,
      lobbyButton.view,
    );
  }

  /** Rounded-panel button in the lobby's visual style, top-left row. */
  private makeButton(
    text: string,
    x: number,
    onTap: () => void,
  ): { view: Container; label: Text } {
    const view = new Container();
    const bg = new Graphics()
      .roundRect(0, 0, BUTTON_WIDTH, BUTTON_HEIGHT, 10)
      .fill(0x1d1630)
      .stroke({ width: 2, color: 0x3a2f5c });
    const label = new Text({
      text,
      style: {
        fontFamily: "Arial",
        fontSize: 18,
        fontWeight: "700",
        letterSpacing: 2,
        fill: 0xcfc4f2,
      },
    });
    label.anchor.set(0.5);
    label.position.set(BUTTON_WIDTH / 2, BUTTON_HEIGHT / 2);
    view.addChild(bg, label);
    view.position.set(x, BUTTON_MARGIN);
    view.alpha = BUTTON_IDLE_ALPHA;
    view.eventMode = "static";
    view.cursor = "pointer";
    view.on("pointertap", onTap);
    view.on("pointerover", () => (view.alpha = 1));
    view.on("pointerout", () => (view.alpha = BUTTON_IDLE_ALPHA));
    return { view, label };
  }

  private togglePause(): void {
    if (this.finished) return;
    this.paused = !this.paused;
    this.pauseOverlay.visible = this.paused;
    this.pauseLabel.text = this.paused ? "RESUME" : "PAUSE";
    if (this.paused) {
      void this.clock.pause();
    } else {
      void this.clock.resume();
    }
  }

  /** Bail straight back to the lobby, skipping results. */
  private quit(): void {
    if (this.finished) return;
    this.finished = true;
    this.onQuit();
  }

  private async loadSong(): Promise<void> {
    const res = await fetch(`${SONG_DIR}chart.json`);
    if (!res.ok) throw new Error(`chart fetch failed: ${res.status}`);
    const chart = parseChart(await res.json());
    this.chart = chart;
    this.notes = chart.notes.map((n) => ({
      t: n.t,
      lane: n.lane,
      judgement: null,
    }));
    this.lastNoteT = this.notes.length
      ? this.notes[this.notes.length - 1].t
      : 0;
    this.judge = new Judge(this.notes);
    this.score = new ScoreState(this.notes.length);
    await this.clock.load(SONG_DIR + chart.song.audioFile);
  }

  private onLane(lane: number): void {
    if (this.paused) return;
    void this.clock.resume();
    this.track.flash(lane);
    if (!this.judge || !this.score || !this.clock.started) return;
    const hit = this.judge.tryHit(lane, this.clock.songTime());
    if (!hit) return; // ghost tap — no penalty
    this.track.hitBurst(lane, hit.judgement);
    this.score.apply(hit.judgement);
    this.bus.emit("judgement", {
      judgement: hit.judgement,
      lane,
      deltaMs: hit.delta * 1000,
      combo: this.score.combo,
      score: this.score.score,
    });
  }

  private readonly onAnyKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      this.togglePause();
      return;
    }
    if (e.key === "Enter") {
      this.finish();
      return;
    }
    // While paused, a stray key must not unlock/resume the audio context.
    if (this.paused) return;
    void this.clock.resume();
  };

  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.onFinish(this.score?.results() ?? new ScoreState(0).results());
  }

  enter(): void {
    this.input.attach();
    window.addEventListener("keydown", this.onAnyKey);
    this.loadSong().catch((err: unknown) => {
      this.setStatus(`load failed: ${String(err)} — Enter to leave`);
    });
    void this.clock.resume();
  }

  exit(): void {
    this.avatar.dispose();
    this.input.detach();
    window.removeEventListener("keydown", this.onAnyKey);
    this.clock.destroy();
  }

  private setStatus(text: string): void {
    // Canvas Text re-renders on every assignment; only touch it on change.
    if (this.status.text !== text) this.status.text = text;
  }

  update(ticker: Ticker): void {
    if (this.paused) return; // clock is frozen; freeze the visuals too

    this.track.update(ticker);
    this.hud.update(ticker);
    this.avatar.update(ticker);

    if (!this.chart || !this.judge || !this.score) return;
    if (!this.clock.loaded) return;
    if (!this.clock.running) {
      this.setStatus("press any key to enable audio");
      return;
    }
    if (!this.clock.started) {
      this.clock.start(2);
      this.setStatus(
        `${this.chart.song.title} — D F J K to play, Enter to bail`,
      );
    }

    const t = this.clock.songTime();

    for (const missed of this.judge.sweepMisses(t)) {
      this.score.apply("miss");
      this.bus.emit("judgement", {
        judgement: "miss",
        lane: missed.lane,
        deltaMs: null,
        combo: this.score.combo,
        score: this.score.score,
      });
    }

    this.track.sync(this.notes, t);

    const allJudged = this.score.judgedCount === this.notes.length;
    const pastEnd =
      t > this.lastNoteT + OUTRO_S || t > this.chart.song.duration + 1;
    if (this.notes.length > 0 && allJudged && pastEnd) this.finish();
  }
}
