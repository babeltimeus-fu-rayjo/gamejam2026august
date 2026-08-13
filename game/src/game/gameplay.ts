import { Container, Graphics, Text, Ticker } from "pixi.js";
import { Avatar } from "../art/avatar";
import type { CharacterDef } from "../art/characters";
import { SONG_DIR, VIRTUAL_HEIGHT, VIRTUAL_WIDTH } from "../config";
import { parseChart, type Chart } from "../core/beatmap";
import { applyDifficulty, type Difficulty } from "../core/difficulty";
import { AudioClock } from "../core/clock";
import { Emitter } from "../core/events";
import { LaneInput } from "../core/input";
import { GameplayRelay } from "../net/relay";
import { activeRoom } from "../net/room";
import { GhostHud } from "../ui/ghost-hud";
import { Hud } from "../ui/hud";
import { Judge, noteWeight, type JudgedNote, type Resolution } from "./judge";
import { ScoreState, type GameEvents, type PlayResults } from "./score";
import { Track } from "./track";
import type { Scene } from "./scenes";

/** Grace period after the last judged note before results. */
const OUTRO_S = 1.5;

/** Lead-in the host schedules for a networked start. */
const GO_LEAD_MS = 2000;
/** Past this, a peer that never armed is treated as absent. */
const NET_START_TIMEOUT_MS = 15000;

// Top-left corner buttons (pause / back to lobby).
const BUTTON_HEIGHT = 40;
const BUTTON_WIDTH = 130;
const BUTTON_MARGIN = 20;
const BUTTON_GAP = 12;
const BUTTON_IDLE_ALPHA = 0.85;

/**
 * Gameplay: loads chart.json + audio, derives the chosen difficulty, plays
 * all four lanes with pooled note sprites, applies scoring through the event
 * bus (HUD subscribes), and hands PlayResults to the results scene. Taps are
 * judged on keydown, holds on keydown *and* keyup. Enter bails out early
 * with partial results.
 */
export class GameplayScene implements Scene {
  readonly view = new Container();

  private readonly clock = new AudioClock();
  private readonly bus = new Emitter<GameEvents>();
  private readonly track: Track;
  private readonly hud = new Hud(this.bus);
  // Player sits right of the track; a future multiplayer opponent takes
  // side: "left" with its own bus (see PLAN.md M4/M6).
  private readonly avatar: Avatar;
  private readonly input = new LaneInput({
    onPress: (lane) => this.onPress(lane),
    onRelease: (lane) => this.onRelease(lane),
  });
  // Null in single play: the whole net layer stays dormant unless the lobby
  // opened a room.
  private readonly room = activeRoom();
  private readonly ghost = new GhostHud(this.room);
  private readonly relay = this.room
    ? new GameplayRelay(this.room, this.bus, () => this.clock.songTime())
    : null;
  /** Unsubscribe for the host's `go`; see beginPlayback. */
  private readonly offGo =
    this.room?.bus.on("go", ({ inMs }) => {
      // Straight to the hardware audio clock — no frame-timer round trip.
      this.clock.start(inMs / 1000);
    }) ?? null;
  private readonly status: Text;

  private readonly pauseLabel: Text;
  private readonly pauseOverlay: Container;

  private chart: Chart | null = null;
  private notes: JudgedNote[] = [];
  private judge: Judge | null = null;
  private score: ScoreState | null = null;
  private armedSent = false;
  private goSent = false;
  private waitingForPeerMs = 0;
  private lastNoteT = 0;
  private finished = false;
  private paused = false;

  constructor(
    private readonly difficulty: Difficulty,
    private readonly onFinish: (results: PlayResults) => void,
    private readonly onQuit: () => void,
    character: CharacterDef,
  ) {
    this.avatar = new Avatar({
      side: "right",
      character,
      bus: this.bus,
    });
    // Scroll speed is the difficulty's headline dial, so the track can only
    // be built once the difficulty is in hand — hence the constructor body
    // rather than a field initializer.
    this.track = new Track(difficulty.scrollSpeed);

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
      this.ghost.view,
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
      // Lift held keys before freezing: a hold left live across a pause
      // would complete itself the instant the clock jumps past its end.
      this.input.releaseAll();
      void this.clock.pause();
    } else {
      void this.clock.resume();
    }
  }

  /** Bail straight back to the lobby, skipping results. */
  private quit(): void {
    if (this.finished) return;
    this.finished = true;
    // Send what we had: the opponent's ghost otherwise sits frozen at our
    // last hit, looking like a live player who stopped scoring.
    if (this.score) this.relay?.finish(this.score.results());
    this.onQuit();
  }

  private async loadSong(): Promise<void> {
    const res = await fetch(`${SONG_DIR}chart.json`);
    if (!res.ok) throw new Error(`chart fetch failed: ${res.status}`);
    const chart = applyDifficulty(
      parseChart(await res.json()),
      this.difficulty,
    );
    this.chart = chart;
    this.notes = chart.notes.map((n) => ({
      t: n.t,
      lane: n.lane,
      d: n.type === "hold" ? (n.d ?? 0) : 0,
      judgement: null,
      tail: null,
      holding: false,
    }));
    // The song is over when the last thing to judge has passed, and a hold's
    // tail outlives its head.
    this.lastNoteT = this.notes.reduce((max, n) => Math.max(max, n.t + n.d), 0);
    this.judge = new Judge(this.notes, this.difficulty.windowScale);
    this.score = new ScoreState(
      this.notes.reduce((sum, n) => sum + noteWeight(n), 0),
    );
    await this.clock.load(SONG_DIR + chart.song.audioFile);
  }

  /** Score one half of one note and tell the HUD, avatar, and track about it. */
  private applyResolution(r: Resolution): void {
    if (!this.score) return;
    if (r.judgement !== "miss") this.track.hitBurst(r.note.lane, r.judgement);
    this.score.apply(r.judgement);
    this.bus.emit("judgement", {
      judgement: r.judgement,
      lane: r.note.lane,
      deltaMs: r.delta === null ? null : r.delta * 1000,
      combo: this.score.combo,
      score: this.score.score,
    });
  }

  private onPress(lane: number): void {
    if (this.paused) return;
    void this.clock.resume();
    this.track.flash(lane);
    if (!this.judge || !this.score || !this.clock.started) return;
    const hit = this.judge.tryHit(lane, this.clock.songTime());
    if (!hit) return; // ghost tap — no penalty
    this.applyResolution(hit);
  }

  /** Only holds care: a release with no live hold under it resolves nothing. */
  private onRelease(lane: number): void {
    if (!this.judge || !this.score || !this.clock.started) return;
    const tail = this.judge.release(lane, this.clock.songTime());
    if (tail) this.applyResolution(tail);
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

  /**
   * Start playback, aligned with the opponent when there is one.
   *
   * Solo starts immediately. In a room, both sides decode audio and unlock
   * their AudioContext at different moments, so scene-switch alignment isn't
   * enough: each side announces `armed`, the host waits for everyone, then
   * broadcasts `go`. Receivers hand `inMs` straight to AudioClock.start(),
   * scheduling on the hardware audio clock rather than a frame timer; the
   * host adds its own half-RTT so both songs reach t=0 together.
   *
   * Returns true once the clock has been started.
   */
  private beginPlayback(deltaMS: number): boolean {
    const room = this.room;
    if (!room || room.peers.length === 0) {
      this.clock.start(2);
      return true;
    }

    if (!this.armedSent) {
      this.armedSent = true;
      room.setArmed(true);
    }

    // Never let a silent peer strand the player at a black screen.
    this.waitingForPeerMs += deltaMS;
    if (this.waitingForPeerMs > NET_START_TIMEOUT_MS) {
      this.setStatus("opponent never started — playing solo");
      this.clock.start(2);
      return true;
    }

    if (room.isHost && room.allArmed && !this.goSent) {
      this.goSent = true;
      void room.pingPeer().then((rtt) => {
        room.announceGo(GO_LEAD_MS);
        // Peers start GO_LEAD_MS after receipt, i.e. one trip later than
        // this send; wait that out so both reach t=0 at the same instant.
        const oneWayMs = rtt === null ? 0 : rtt / 2;
        this.clock.start((GO_LEAD_MS + oneWayMs) / 1000);
      });
    }

    this.setStatus(
      room.allArmed ? "starting together…" : "waiting for opponent to load…",
    );
    return false;
  }

  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    const results = this.score?.results() ?? new ScoreState(0).results();
    this.relay?.finish(results, this.difficulty.id);
    this.onFinish(results);
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
    this.ghost.dispose();
    this.relay?.dispose();
    this.offGo?.();
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
    this.ghost.update(ticker);
    this.avatar.update(ticker);

    if (!this.chart || !this.judge || !this.score) return;
    if (!this.clock.loaded) return;
    if (!this.clock.running) {
      this.setStatus("press any key to enable audio");
      return;
    }
    if (!this.clock.started) {
      if (!this.beginPlayback(ticker.deltaMS)) return;
      this.setStatus(
        `${this.chart.song.title} · ${this.difficulty.label} — D F J K, hold the long notes, Enter to bail`,
      );
    }

    const t = this.clock.songTime();

    for (const resolution of this.judge.sweep(t)) {
      this.applyResolution(resolution);
    }

    this.track.sync(this.notes, t);

    this.relay?.tick(ticker.deltaMS, {
      combo: this.score.combo,
      score: this.score.score,
      judged: this.score.judgedCount,
    });

    // main's count: totalNotes covers holds, which contribute more than one
    // judgement each, so notes.length would finish the song early.
    const allJudged = this.score.judgedCount === this.score.totalNotes;
    const pastEnd =
      t > this.lastNoteT + OUTRO_S || t > this.chart.song.duration + 1;
    if (this.notes.length > 0 && allJudged && pastEnd) this.finish();
  }
}
