import { Container, Graphics, Text, Ticker } from "pixi.js";
import { CHARACTERS, type CharacterDef } from "../art/characters";
import {
  SONG_DIR,
  VIRTUAL_HEIGHT,
  VIRTUAL_WIDTH,
  type GameMode,
} from "../config";
import {
  activeRoom,
  joinNetRoom,
  leaveNetRoom,
  type RemotePlayer,
} from "../net/room";
import { playerName } from "../net/identity";
import {
  chartHash,
  isCompleteRoomCode,
  makeRoomCode,
  normalizeRoomCode,
  ROOM_CODE_LENGTH,
} from "../net/protocol";
import {
  DIFFICULTIES,
  difficultyLabel,
  stepDifficulty,
  type DifficultyId,
} from "../core/difficulty";
import type { Scene } from "./scenes";

const ROW_KEYS = [
  "MODE",
  "TRACK",
  "DIFFICULTY",
  "AVATAR",
  "ROOM",
  "PLAYERS",
  "START",
] as const;
type RowKey = (typeof ROW_KEYS)[number];

const PANEL_WIDTH = 760;
const PANEL_HEIGHT = 56;
// Tightened from 18 when the row count reached seven; any looser and the
// bottom row runs off the 720-tall virtual canvas.
const ROW_GAP = 14;

/**
 * Lead-in before a networked start. Long enough to absorb one-way relay
 * latency (tens of ms) so both clients switch scenes within a frame or two
 * of each other; short enough not to feel like a stall.
 */
const START_DELAY_MS = 1500;

/**
 * Lobby: track stub, multiplayer room (create / join by code / ready), and
 * start. Solo play is unchanged — Enter starts immediately, and nothing
 * touches the network until the player asks for a room.
 *
 * The room itself is a module singleton (`net/room.ts`), not scene state:
 * it has to survive the switch into gameplay, while scenes are destroyed on
 * every transition.
 */
export class LobbyScene implements Scene {
  readonly view = new Container();

  private readonly values = {} as Record<RowKey, Text>;
  private readonly unsubscribes: (() => void)[] = [];

  private mode: "solo" | "joining" | "room" = "solo";
  private codeBuffer = "";
  private status = "";
  private peers: readonly RemotePlayer[] = [];
  private chartHashValue: string | null = null;
  private startTimer: number | null = null;
  private startingInMs: number | null = null;
  private started = false;
  private elapsed = 0;
  private characterIndex: number;

  constructor(
    private readonly gameMode: GameMode,
    character: CharacterDef,
    private readonly onCharacter: (character: CharacterDef) => void,
    private difficulty: DifficultyId,
    private readonly onDifficulty: (difficulty: DifficultyId) => void,
    private readonly onStart: () => void,
  ) {
    this.characterIndex = Math.max(
      0,
      CHARACTERS.findIndex((c) => c.id === character.id),
    );
    const heading = new Text({
      text: "LOBBY",
      style: {
        fontFamily: "Arial",
        fontSize: 64,
        fontWeight: "900",
        letterSpacing: 6,
        fill: 0xffffff,
      },
    });
    heading.anchor.set(0.5);
    heading.position.set(VIRTUAL_WIDTH / 2, VIRTUAL_HEIGHT * 0.13);
    this.view.addChild(heading);

    const panelX = (VIRTUAL_WIDTH - PANEL_WIDTH) / 2;
    const firstY = VIRTUAL_HEIGHT * 0.26;

    ROW_KEYS.forEach((key, i) => {
      const y = firstY + i * (PANEL_HEIGHT + ROW_GAP);

      const panel = new Graphics()
        .roundRect(panelX, y, PANEL_WIDTH, PANEL_HEIGHT, 10)
        .fill(0x1d1630);

      const label = new Text({
        text: key,
        style: {
          fontFamily: "Arial",
          fontSize: 22,
          fontWeight: "700",
          letterSpacing: 3,
          fill: 0xcfc4f2,
        },
      });
      label.anchor.set(0, 0.5);
      label.position.set(panelX + 32, y + PANEL_HEIGHT / 2);

      const value = new Text({
        text: "",
        style: {
          fontFamily: "Arial",
          fontSize: 22,
          // White so the difficulty row can recolour itself with `tint`,
          // which costs nothing, instead of re-rendering the text canvas.
          fill: key === "DIFFICULTY" ? 0xffffff : 0x9f8fd8,
        },
      });
      value.anchor.set(0, 0.5);
      value.position.set(panelX + 200, y + PANEL_HEIGHT / 2);

      this.values[key] = value;
      this.view.addChild(panel, label, value);
    });

    // Returning from results with a room still open: re-attach to it.
    const existing = activeRoom();
    if (existing) {
      this.mode = "room";
      this.peers = existing.peers;
      this.subscribe();
    }
    this.render();
  }

  /**
   * Hash the chart so peers can verify they're on the same track and build.
   * Difficulty is *not* in the hash — see HelloMsg.difficulty: players pick
   * independently, and mirror play never puts note data on the wire.
   */
  private async loadChartHash(): Promise<void> {
    const res = await fetch(`${SONG_DIR}chart.json`);
    if (!res.ok) throw new Error(`chart fetch failed: ${res.status}`);
    this.chartHashValue = chartHash(await res.text());
    this.render();
  }

  private cycleDifficulty(step: number): void {
    const next = stepDifficulty(this.difficulty, step);
    if (next === this.difficulty) return;
    this.difficulty = next;
    this.onDifficulty(next);
    activeRoom()?.setDifficulty(next);
    this.render();
  }

  private subscribe(): void {
    const room = activeRoom();
    if (!room) return;
    this.unsubscribes.push(
      room.bus.on("peers", (peers) => {
        this.peers = peers;
        this.render();
      }),
      room.bus.on("status", (text) => {
        this.status = text;
        this.render();
      }),
      room.bus.on("mismatch", ({ theirs }) => {
        this.status = `chart mismatch (peer ${theirs}) — same track and build required`;
        this.render();
      }),
      room.bus.on("start", (msg) => {
        if (msg.chartHash !== this.chartHashValue) {
          this.status = "refused start: different chart";
          this.render();
          return;
        }
        this.scheduleStart(msg.inMs);
      }),
    );
  }

  private unsubscribeAll(): void {
    for (const off of this.unsubscribes) off();
    this.unsubscribes.length = 0;
  }

  private async createRoom(): Promise<void> {
    await this.enterRoom(makeRoomCode());
  }

  private async enterRoom(code: string): Promise<void> {
    if (!this.chartHashValue) {
      this.status = "still loading the chart…";
      this.render();
      return;
    }
    this.unsubscribeAll();
    await joinNetRoom(code, {
      name: playerName(),
      chartId: SONG_DIR,
      chartHash: this.chartHashValue,
      difficulty: this.difficulty,
    });
    this.mode = "room";
    this.peers = [];
    // The room emits its first status before we can subscribe (it happens in
    // the constructor), so seed the line here.
    this.status = "waiting for a peer…";
    this.subscribe();
    this.render();
  }

  private async exitRoom(): Promise<void> {
    this.unsubscribeAll();
    await leaveNetRoom();
    this.mode = "solo";
    this.peers = [];
    this.status = "";
    this.render();
  }

  private scheduleStart(inMs: number): void {
    if (this.started || this.startTimer !== null) return;
    this.startingInMs = inMs;
    this.startTimer = window.setTimeout(() => {
      this.startTimer = null;
      this.begin();
    }, inMs);
    this.render();
  }

  private begin(): void {
    if (this.started) return;
    this.started = true;
    this.onStart();
  }

  private tryStart(): void {
    if (this.mode !== "room") {
      this.begin();
      return;
    }
    const room = activeRoom();
    if (!room) return;
    if (room.peers.length === 0) {
      this.status = "no peer yet — share the code, or Esc to play solo";
      this.render();
      return;
    }
    if (!room.allReady) {
      this.status = "waiting for everyone to press R";
      this.render();
      return;
    }
    this.scheduleStart(room.announceStart(START_DELAY_MS).inMs);
  }

  private handleCodeEntry(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      this.mode = "solo";
      this.codeBuffer = "";
      this.render();
      return;
    }
    if (e.key === "Backspace") {
      this.codeBuffer = this.codeBuffer.slice(0, -1);
      this.render();
      return;
    }
    if (e.key === "Enter") {
      if (isCompleteRoomCode(this.codeBuffer))
        void this.enterRoom(this.codeBuffer);
      return;
    }
    if (e.key.length === 1) {
      this.codeBuffer = normalizeRoomCode(this.codeBuffer + e.key);
      this.render();
    }
  }

  /**
   * Keys that must not trigger the solo any-key start: bare modifiers
   * (Shift alone shouldn't launch a game) and events with no key name —
   * some browsers and input tools emit keydown with "" or "Unidentified".
   */
  private static readonly NON_STARTER_KEYS = [
    "Shift",
    "Control",
    "Alt",
    "Meta",
    "Unidentified",
    "",
  ];

  private cycleCharacter(step: number): void {
    const n = CHARACTERS.length;
    this.characterIndex = (this.characterIndex + step + n) % n;
    this.onCharacter(CHARACTERS[this.characterIndex]);
    this.render();
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    if (this.startTimer !== null) return; // start already committed
    if (this.mode === "joining") {
      this.handleCodeEntry(e);
      return;
    }
    // Both pickers sit ahead of the solo any-key start, or setting one up
    // would launch the run. Avatar takes the horizontal axis and difficulty
    // the vertical; both are local-only, so they work inside a room too.
    // "Left"/"Up"/… are legacy key names (pre-standard browsers/webviews).
    if (e.key === "ArrowLeft" || e.key === "Left") {
      this.cycleCharacter(-1);
      return;
    }
    if (e.key === "ArrowRight" || e.key === "Right") {
      this.cycleCharacter(1);
      return;
    }
    // Up is the *easier* direction: the list reads easiest-first, and a row
    // of difficulties climbing away from you is the wrong mental model.
    if (e.key === "ArrowUp" || e.key === "Up") {
      this.cycleDifficulty(-1);
      return;
    }
    if (e.key === "ArrowDown" || e.key === "Down") {
      this.cycleDifficulty(1);
      return;
    }
    const key = e.key.toLowerCase();

    if (this.mode === "solo") {
      if (key === "c") {
        void this.createRoom();
        return;
      }
      if (key === "j") {
        this.mode = "joining";
        this.codeBuffer = "";
        this.render();
        return;
      }
      // Single mode keeps the "press any key" feel; C and J are the only keys
      // multiplayer claims, so a player who never opens a room won't notice.
      // Battle mode does NOT: someone who chose head-to-head on the title
      // screen must not be dropped into a solo run by a stray keypress.
      if (this.gameMode === "battle") {
        if (key === "enter") this.tryStart();
        return;
      }
      if (!LobbyScene.NON_STARTER_KEYS.includes(e.key)) this.begin();
      return;
    }

    // In a room every key is explicit: a stray keypress must not drag a
    // waiting peer into a game.
    switch (key) {
      case "enter":
        this.tryStart();
        break;
      case "r": {
        const room = activeRoom();
        if (room) room.setReady(!room.ready);
        this.render();
        break;
      }
      case "escape":
        void this.exitRoom();
        break;
    }
  };

  private roomValue(): string {
    if (this.mode === "joining") {
      const shown = this.codeBuffer
        .padEnd(ROOM_CODE_LENGTH, "_")
        .split("")
        .join(" ");
      return `join code: ${shown}   (Enter to join, Esc to cancel)`;
    }
    const room = activeRoom();
    if (this.mode === "room" && room) {
      return `code ${room.code}${this.status ? ` — ${this.status}` : ""}`;
    }
    if (!this.chartHashValue) return "loading chart…";
    return this.gameMode === "battle"
      ? "[C] create room, [J] join by code"
      : "solo — [C] create room, [J] join by code";
  }

  private modeValue(): string {
    return this.gameMode === "battle"
      ? "Battle — head to head over the network"
      : "Single — solo run";
  }

  private difficultyValue(): string {
    const d = DIFFICULTIES[this.difficulty];
    // No "(↑/↓ to change)" tail: with the blurb it overruns the panel, and
    // the AVATAR row directly below spells the arrow idiom out.
    return `▲  ${d.label}  ▼   ${d.blurb}`;
  }

  /**
   * Each player's own difficulty is shown beside their name: a mixed room is
   * allowed, so the disagreement has to be visible rather than blocked.
   */
  private playersValue(): string {
    const room = activeRoom();
    if (this.mode !== "room" || !room) return "solo play";
    const label = DIFFICULTIES[this.difficulty].label;
    const you = `you [${label}] ${room.ready ? "✓ ready" : "· waiting"}`;
    if (this.peers.length === 0) return `${you}   (no peers yet)`;
    const others = this.peers
      .map(
        (p) =>
          `${p.name} [${difficultyLabel(p.difficulty)}] ${p.ready ? "✓ ready" : "· waiting"}`,
      )
      .join("   ");
    return `${you}   ${others}`;
  }

  private startValue(): string {
    if (this.startingInMs !== null) return "starting…";
    if (this.mode === "room") {
      // Raw score scales with note count, so say up front what a mixed room
      // is actually settled on before anyone plays for the wrong number.
      const mixed = this.peers.some(
        (p) => p.difficulty !== null && p.difficulty !== this.difficulty,
      );
      return mixed
        ? "[R] ready, Enter to start — mixed room, ranked on accuracy"
        : "[R] ready, Enter to start once all ready";
    }
    return this.gameMode === "battle" ? "press Enter" : "press any key";
  }

  private avatarValue(): string {
    return `◄  ${CHARACTERS[this.characterIndex].name}  ►   (←/→ to change)`;
  }

  private render(): void {
    this.setValue("MODE", this.modeValue());
    this.setValue("TRACK", "Demo Track — chart select lands in M3");
    this.setValue("DIFFICULTY", this.difficultyValue());
    this.values.DIFFICULTY.tint = DIFFICULTIES[this.difficulty].color;
    this.setValue("AVATAR", this.avatarValue());
    this.setValue("ROOM", this.roomValue());
    this.setValue("PLAYERS", this.playersValue());
    this.setValue("START", this.startValue());
  }

  /** Canvas Text re-renders on every assignment; only touch it on change. */
  private setValue(key: RowKey, text: string): void {
    if (this.values[key].text !== text) this.values[key].text = text;
  }

  enter(): void {
    window.addEventListener("keydown", this.onKeyDown);
    this.loadChartHash().catch((err: unknown) => {
      this.status = `chart load failed: ${String(err)}`;
      this.render();
    });
  }

  exit(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    this.unsubscribeAll();
    if (this.startTimer !== null) window.clearTimeout(this.startTimer);
    // The room deliberately outlives this scene — gameplay needs it. Only an
    // explicit Esc leaves it.
  }

  update(ticker: Ticker): void {
    this.elapsed += ticker.deltaMS;
    this.values.START.alpha = 0.6 + 0.4 * Math.sin(this.elapsed / 350);
  }
}
