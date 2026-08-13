import { Container, Graphics, Text, Ticker } from "pixi.js";
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
import {
  chartHash,
  isCompleteRoomCode,
  makeRoomCode,
  normalizeRoomCode,
  ROOM_CODE_LENGTH,
} from "../net/protocol";
import type { Scene } from "./scenes";

const ROW_KEYS = ["MODE", "TRACK", "ROOM", "PLAYERS", "START"] as const;
type RowKey = (typeof ROW_KEYS)[number];

const PANEL_WIDTH = 760;
const PANEL_HEIGHT = 56;
const ROW_GAP = 18;

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

  constructor(
    mode: GameMode,
    private readonly onStart: () => void,
  ) {
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
    heading.position.set(VIRTUAL_WIDTH / 2, VIRTUAL_HEIGHT * 0.2);
    this.view.addChild(heading);

    const panelX = (VIRTUAL_WIDTH - PANEL_WIDTH) / 2;
    const firstY = VIRTUAL_HEIGHT * 0.36;

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
        style: { fontFamily: "Arial", fontSize: 22, fill: 0x9f8fd8 },
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

  /** Hash the chart so peers can verify they're playing the same notes. */
  private async loadChartHash(): Promise<void> {
    const res = await fetch(`${SONG_DIR}chart.json`);
    if (!res.ok) throw new Error(`chart fetch failed: ${res.status}`);
    this.chartHashValue = chartHash(await res.text());
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
        this.status = `chart mismatch (peer ${theirs}) — same build required`;
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
      name: "player",
      chartId: SONG_DIR,
      chartHash: this.chartHashValue,
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

  /** Modifiers alone must not count as "any key". */
  private static isModifier(key: string): boolean {
    return (
      key === "Shift" || key === "Control" || key === "Alt" || key === "Meta"
    );
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    if (this.startTimer !== null) return; // start already committed
    if (this.mode === "joining") {
      this.handleCodeEntry(e);
      return;
    }
    const key = e.key.toLowerCase();

    // Solo keeps the "press any key" feel; C and J are the only keys claimed
    // by multiplayer, so a player who never touches a room never notices it.
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
      if (!LobbyScene.isModifier(e.key)) this.begin();
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
    return this.chartHashValue
      ? "solo — [C] create room, [J] join by code"
      : "loading chart…";
  }

  private playersValue(): string {
    const room = activeRoom();
    if (this.mode !== "room" || !room) return "solo play";
    const you = `you ${room.ready ? "✓ ready" : "· waiting"}`;
    if (this.peers.length === 0) return `${you}   (no peers yet)`;
    const others = this.peers
      .map((p) => `${p.name} ${p.ready ? "✓ ready" : "· waiting"}`)
      .join("   ");
    return `${you}   ${others}`;
  }

  private startValue(): string {
    if (this.startingInMs !== null) return "starting…";
    if (this.mode === "room") return "[R] ready, Enter to start once all ready";
    return "press any key";
  }

  private render(): void {
    this.setValue("TRACK", "Demo Track — chart select lands in M3");
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
