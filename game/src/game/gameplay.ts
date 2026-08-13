import { Container, Graphics, Text, Ticker } from "pixi.js";
import { Avatar } from "../art/avatar";
import { CHARACTERS, type CharacterDef } from "../art/characters";
import { Stage } from "../art/stage";
import {
  songDir,
  VIRTUAL_HEIGHT,
  VIRTUAL_WIDTH,
  type SongDef,
} from "../config";
import { parseChart, type Chart } from "../core/beatmap";
import { applyDifficulty, type Difficulty } from "../core/difficulty";
import { stopMenuBgm } from "../core/bgm";
import { AudioClock } from "../core/clock";
import { Emitter } from "../core/events";
import { LaneInput } from "../core/input";
import { Sfx } from "../core/sfx";
import { GameplayRelay } from "../net/relay";
import { activeRoom } from "../net/room";
import { GhostHud } from "../ui/ghost-hud";
import { Hud } from "../ui/hud";
import {
  shakeOffset,
  SHAKE_DURATION_MS,
  SHAKE_STREAK,
  tierFor,
  type FeedbackTier,
} from "./feedback";
import {
  isHold,
  Judge,
  noteWeight,
  type JudgedNote,
  type Resolution,
} from "./judge";
import {
  MAX_LIFE,
  ScoreState,
  type GameEvents,
  type PlayResults,
} from "./score";
import { TouchLaneOverlay } from "./touch-lanes";
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
  private readonly sfx = new Sfx(this.clock.context);
  private readonly bus = new Emitter<GameEvents>();
  private readonly track: Track;
  private readonly hud: Hud;
  // Player sits right of the track; in a room the opponent's avatar takes
  // side: "left", driven by wire hits through its own bus.
  private readonly avatar: Avatar;
  private readonly opponentBus = new Emitter<GameEvents>();
  private readonly opponentAvatar: Avatar | null;
  private readonly offOpponentHit: (() => void) | null;
  // Keys and fingers are peer sources feeding one per-lane refcount: the
  // judge sees a press on 0→1 and a release on 1→0, so key-D plus a finger
  // on lane 0 doesn't drop a live hold when either one lifts.
  private readonly laneHolds = [0, 0, 0, 0];
  private readonly input = new LaneInput({
    onPress: (lane) => this.pressLane(lane),
    onRelease: (lane) => this.releaseLane(lane),
  });
  private readonly touchLanes = new TouchLaneOverlay({
    onPress: (lane) => this.pressLane(lane),
    onRelease: (lane) => this.releaseLane(lane),
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
  // Illustrated live-house backdrop + reactive LED screen (art/stage.ts).
  private readonly stage: Stage;
  private readonly status: Text;
  /** Song title + difficulty, pinned top-center for the whole run. */
  private readonly songTitle: Text;

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
  /** EXTRAORDINARY hits in a row; every SHAKE_STREAK of them kicks the camera. */
  private shakeStreak = 0;
  /** ms into the running camera shake; at or past the duration means idle. */
  private shakeAgeMs = SHAKE_DURATION_MS;

  constructor(
    private readonly song: SongDef,
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
    // Opponent avatar: the peer's chosen character stands across the stage
    // and replays their wire hits. HitMsg carries every judgement (misses
    // included), so ReactionController works unchanged from remote data.
    const peer = this.room?.peers[0] ?? null;
    this.opponentAvatar = peer
      ? new Avatar({
          side: "left",
          character:
            CHARACTERS.find((c) => c.id === peer.character) ?? CHARACTERS[0],
          bus: this.opponentBus,
        })
      : null;
    this.offOpponentHit =
      this.room && peer
        ? this.room.bus.on("hit", ({ msg }) => {
            this.opponentBus.emit("judgement", {
              judgement: msg.judgement,
              // Same derivation the local side uses, from their wire combo.
              tier: tierFor(msg.judgement, msg.combo),
              lane: msg.lane,
              deltaMs: null,
              combo: msg.combo,
              score: msg.score,
              // Opponent life isn't on the wire; the avatar ignores it.
              life: MAX_LIFE,
            });
          })
        : null;
    // Scroll speed is the difficulty's headline dial, so the track can only
    // be built once the difficulty is in hand — hence the constructor body
    // rather than a field initializer. Same for the HUD's life toggle.
    this.track = new Track(difficulty.scrollSpeed);
    this.hud = new Hud(this.bus, { showLife: difficulty.lifeDrainMiss > 0 });

    // The screen's mirror shows the same character the player picked.
    this.stage = new Stage({ bus: this.bus, character });

    // Top-center, between the corner buttons and the life gauge; filled in
    // once the chart names the song.
    this.songTitle = new Text({
      text: "",
      style: {
        fontFamily: "Arial",
        fontSize: 24,
        fontWeight: "700",
        letterSpacing: 2,
        fill: 0xcfc4f2,
        dropShadow: {
          color: 0x9678c8,
          blur: 10,
          distance: 0,
          angle: 0,
          alpha: 0.8,
        },
      },
    });
    this.songTitle.anchor.set(0.5, 0);
    this.songTitle.position.set(VIRTUAL_WIDTH / 2, 20);

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
      this.stage.view,
      this.avatar.view,
      ...(this.opponentAvatar ? [this.opponentAvatar.view] : []),
      this.track.view,
      // Invisible touch columns over the track; the corner buttons are added
      // later (= above), so they still win their own taps.
      this.touchLanes.view,
      this.hud.view,
      this.ghost.view,
      this.songTitle,
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
      // Lift held keys and fingers before freezing: a hold left live across
      // a pause would complete itself the instant the clock jumps past its
      // end.
      this.input.releaseAll();
      this.touchLanes.releaseAll();
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
    if (this.score) {
      this.relay?.finish(this.score.results(), this.difficulty.id);
    }
    this.onQuit();
  }

  private async loadSong(): Promise<void> {
    const dir = songDir(this.song.id);
    const res = await fetch(`${dir}chart.json`);
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
      this.difficulty.lifeDrainMiss,
    );
    this.songTitle.text = `${chart.song.title}   ·   ${this.difficulty.label}`;
    this.stage.setBeat(chart.bpm, chart.offset);
    await this.clock.load(dir + chart.song.audioFile);
  }

  /** Score one half of one note and tell the HUD, avatar, and track about it. */
  private applyResolution(r: Resolution): void {
    // `finished` also covers death mid-sweep: once the gauge empties, the
    // remaining resolutions of that frame must not touch the dead scene.
    if (!this.score || this.finished) return;
    if (r.judgement !== "miss") {
      // Audible confirmation: tap tick, hold latch, or hold-complete chime.
      // Misses stay silent — the song dropping out IS the miss feedback.
      if (r.part === "tail") this.sfx.holdRelease();
      else if (isHold(r.note)) this.sfx.holdStart(r.judgement);
      else this.sfx.hit(r.judgement);
    }
    // Scoring first: the tier reads the combo this note just produced, so an
    // EXTRAORDINARY shows on the hit that earns it, not on the next one.
    this.score.apply(r.judgement);
    const tier = tierFor(r.judgement, this.score.combo);
    this.track.judged(r.note.lane, tier);
    this.trackShakeStreak(tier);
    this.bus.emit("judgement", {
      judgement: r.judgement,
      tier,
      lane: r.note.lane,
      deltaMs: r.delta === null ? null : r.delta * 1000,
      combo: this.score.combo,
      score: this.score.score,
      life: this.score.life,
    });
    // Out of life: the song fails here, with the run's partial results.
    if (this.score.dead) this.finish();
  }

  /**
   * Every SHAKE_STREAK EXTRAORDINARY hits in a row, kick the camera. Anything
   * less than EXTRAORDINARY — including a GOOD that keeps the combo — puts the
   * count back to zero, so the shake stays a reward for an unbroken run.
   */
  private trackShakeStreak(tier: FeedbackTier): void {
    if (tier !== "extraordinary") {
      this.shakeStreak = 0;
      return;
    }
    this.shakeStreak += 1;
    if (this.shakeStreak < SHAKE_STREAK) return;
    this.shakeStreak = 0;
    this.shakeAgeMs = 0;
  }

  private pressLane(lane: number): void {
    this.laneHolds[lane] += 1;
    if (this.laneHolds[lane] === 1) this.onPress(lane);
    // A redundant source still deserves receptor feedback.
    else if (!this.paused) this.track.flash(lane);
  }

  private releaseLane(lane: number): void {
    if (this.laneHolds[lane] === 0) return;
    this.laneHolds[lane] -= 1;
    if (this.laneHolds[lane] === 0) this.onRelease(lane);
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

  /** Touch twin of the any-key audio unlock (title.ts does the same). */
  private readonly onAnyPointer = (): void => {
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
    // The menus' music runs on a shared instance that outlives their scenes,
    // so it has to be stopped here or it would play under the song.
    stopMenuBgm();
    this.input.attach();
    window.addEventListener("keydown", this.onAnyKey);
    // Window-level so a tap anywhere — letterbox included — unlocks audio.
    window.addEventListener("pointerdown", this.onAnyPointer);
    this.loadSong().catch((err: unknown) => {
      this.setStatus(`load failed: ${String(err)} — Enter to leave`);
    });
    void this.clock.resume();
  }

  exit(): void {
    this.stage.dispose();
    this.avatar.dispose();
    this.opponentAvatar?.dispose();
    this.offOpponentHit?.();
    this.ghost.dispose();
    this.relay?.dispose();
    this.offGo?.();
    this.input.detach();
    window.removeEventListener("keydown", this.onAnyKey);
    window.removeEventListener("pointerdown", this.onAnyPointer);
    this.clock.destroy();
  }

  private setStatus(text: string): void {
    // Canvas Text re-renders on every assignment; only touch it on change.
    if (this.status.text !== text) this.status.text = text;
  }

  /**
   * Camera shake: the scene's whole view is offset, so track, HUD and avatar
   * kick together. The scene sits inside the letterboxed root, so a few px of
   * travel never uncovers anything but the backdrop behind it.
   */
  private updateShake(ticker: Ticker): void {
    if (this.shakeAgeMs >= SHAKE_DURATION_MS) return;
    this.shakeAgeMs += ticker.deltaMS;
    if (this.shakeAgeMs >= SHAKE_DURATION_MS) {
      this.view.position.set(0, 0);
      return;
    }
    const { x, y } = shakeOffset(this.shakeAgeMs);
    this.view.position.set(x, y);
  }

  update(ticker: Ticker): void {
    if (this.paused) return; // clock is frozen; freeze the visuals too

    this.updateShake(ticker);
    this.track.update(ticker);
    this.hud.update(ticker);
    this.ghost.update(ticker);
    this.avatar.update(ticker);
    this.opponentAvatar?.update(ticker);
    this.stage.update(
      ticker,
      this.clock.started ? this.clock.songTime() : null,
    );

    if (!this.chart || !this.judge || !this.score) return;
    if (!this.clock.loaded) return;
    if (!this.clock.running) {
      this.setStatus("press any key or tap to enable audio");
      return;
    }
    if (!this.clock.started) {
      if (!this.beginPlayback(ticker.deltaMS)) return;
      // Title and difficulty live in the top-center readout now.
      this.setStatus(
        "D F J K or touch the lanes, hold the long notes, Enter to bail",
      );
    }

    const t = this.clock.songTime();

    for (const resolution of this.judge.sweep(t)) {
      this.applyResolution(resolution);
    }
    // A sweep miss can empty the life gauge; finish() has then already
    // destroyed the scene, so nothing below may touch it.
    if (this.finished) return;

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
