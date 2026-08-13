/**
 * Trystero wrapper for mirror-play rooms (PLAN.md §8).
 *
 * Signaling rides public Nostr relays — no server of ours, which is the whole
 * reason multiplayer fits a jam. Peers are matched by a short room code
 * namespaced under APP_ID; the code is the only thing a player shares.
 *
 * Scenes never touch Trystero directly: they read `activeRoom()` and
 * subscribe to `bus`, so the transport can be swapped without touching UI.
 */
import { joinRoom, selfId, type Room as TrysteroRoom } from "trystero";
import { Emitter } from "../core/events";
import {
  ACTIONS,
  PROTOCOL_VERSION,
  type ArmedMsg,
  type FinishMsg,
  type GoMsg,
  type HelloMsg,
  type HitMsg,
  type ReadyMsg,
  type StartMsg,
  type StateMsg,
} from "./protocol";

/** Namespaces our rooms on shared public relays. */
const APP_ID = "babeltime-gamejam2026-rhythm";

/** How long peers get to appear before we call a room empty, ms. */
const LONELY_AFTER_MS = 8000;

/**
 * After this, a still-empty room is worth explaining rather than just
 * reporting. We can't tell "nobody joined" from "the peer connected to the
 * relay but the direct connection never formed" — the ~10–15% of NAT
 * combinations that need a TURN relay (PLAN.md §8, out of jam scope) look
 * identical from here — so the message has to cover both.
 */
const UNREACHABLE_AFTER_MS = 25000;

export interface RemotePlayer {
  id: string;
  name: string;
  ready: boolean;
  /** Audio decoded and context unlocked — see ArmedMsg. */
  armed: boolean;
  /** null until their hello lands. */
  chartHash: string | null;
  /** Their chosen difficulty; null until their hello lands. May differ. */
  difficulty: string | null;
  /** Their avatar character id; null until their hello lands. */
  character: string | null;
  combo: number;
  score: number;
  finish: FinishMsg | null;
}

export type NetEvents = {
  /** Roster changed (join, leave, ready, hello, score). */
  peers: readonly RemotePlayer[];
  /** Human-readable connection state for the lobby row. */
  status: string;
  /** Host said go; schedule the scene switch after `inMs`. */
  start: StartMsg;
  /** Host said go for *audio*; hand `inMs` to AudioClock.start(). */
  go: GoMsg;
  hit: { peerId: string; msg: HitMsg };
  state: { peerId: string; msg: StateMsg };
  finish: { peerId: string; msg: FinishMsg };
  /** Peer is on a different chart — starting is blocked until it matches. */
  mismatch: { peerId: string; theirs: string };
};

export interface RoomIdentity {
  name: string;
  chartId: string;
  chartHash: string;
  /** Per-player, not part of the agreement — see HelloMsg.difficulty. */
  difficulty: string;
  /** Avatar character id — see HelloMsg.character. */
  character: string;
}

/**
 * One joined room. Construction joins immediately; `leave()` is required to
 * release the relay sockets (scenes call it via `leaveNetRoom`).
 */
export class NetRoom {
  readonly bus = new Emitter<NetEvents>();
  readonly selfId = selfId;

  private readonly room: TrysteroRoom;
  private readonly players = new Map<string, RemotePlayer>();
  private readonly sendHello: (msg: HelloMsg, target?: string) => void;
  private readonly sendReady: (msg: ReadyMsg) => void;
  private readonly sendStart: (msg: StartMsg) => void;
  private readonly sendArmed: (msg: ArmedMsg) => void;
  private readonly sendGo: (msg: GoMsg) => void;
  private readonly sendHitMsg: (msg: HitMsg) => void;
  private readonly sendStateMsg: (msg: StateMsg) => void;
  private readonly sendFinishMsg: (msg: FinishMsg) => void;
  private readonly timers: number[] = [];

  private localReady = false;
  private left = false;

  constructor(
    readonly code: string,
    private identity: RoomIdentity,
  ) {
    this.room = joinRoom({ appId: APP_ID }, code, {
      onJoinError: ({ error }) => {
        this.bus.emit("status", `room error: ${error}`);
      },
    });

    const hello = this.room.makeAction<HelloMsg>(ACTIONS.hello, {
      onMessage: (msg, { peerId }) => this.onHello(peerId, msg),
    });
    this.sendHello = (msg, target) => {
      void hello.send(msg, target ? { target } : undefined);
    };

    const ready = this.room.makeAction<ReadyMsg>(ACTIONS.ready, {
      onMessage: (msg, { peerId }) => {
        this.patch(peerId, { ready: msg.ready });
      },
    });
    this.sendReady = (msg) => void ready.send(msg);

    const start = this.room.makeAction<StartMsg>(ACTIONS.start, {
      onMessage: (msg) => this.bus.emit("start", msg),
    });
    this.sendStart = (msg) => void start.send(msg);

    const armed = this.room.makeAction<ArmedMsg>(ACTIONS.armed, {
      onMessage: (msg, { peerId }) => {
        this.patch(peerId, { armed: msg.armed });
      },
    });
    this.sendArmed = (msg) => void armed.send(msg);

    const go = this.room.makeAction<GoMsg>(ACTIONS.go, {
      onMessage: (msg) => this.bus.emit("go", msg),
    });
    this.sendGo = (msg) => void go.send(msg);

    const hit = this.room.makeAction<HitMsg>(ACTIONS.hit, {
      onMessage: (msg, { peerId }) => {
        this.patch(peerId, { combo: msg.combo, score: msg.score });
        this.bus.emit("hit", { peerId, msg });
      },
    });
    this.sendHitMsg = (msg) => void hit.send(msg);

    const state = this.room.makeAction<StateMsg>(ACTIONS.state, {
      onMessage: (msg, { peerId }) => {
        this.patch(peerId, { combo: msg.combo, score: msg.score });
        this.bus.emit("state", { peerId, msg });
      },
    });
    this.sendStateMsg = (msg) => void state.send(msg);

    const finish = this.room.makeAction<FinishMsg>(ACTIONS.finish, {
      onMessage: (msg, { peerId }) => {
        this.patch(peerId, { finish: msg });
        this.bus.emit("finish", { peerId, msg });
      },
    });
    this.sendFinishMsg = (msg) => void finish.send(msg);

    this.room.onPeerJoin = (peerId) => {
      this.players.set(peerId, {
        id: peerId,
        name: peerId.slice(0, 4),
        ready: false,
        armed: false,
        chartHash: null,
        difficulty: null,
        character: null,
        combo: 0,
        score: 0,
        finish: null,
      });
      // Targeted: only the newcomer needs our details.
      this.sendHello(this.helloMsg(), peerId);
      this.emitPeers();
      this.bus.emit("status", "peer connected");
    };

    this.room.onPeerLeave = (peerId) => {
      this.players.delete(peerId);
      this.emitPeers();
      this.bus.emit("status", "peer left");
    };

    this.bus.emit("status", "waiting for a peer…");
    this.timers.push(
      window.setTimeout(() => {
        if (this.players.size === 0 && !this.left) {
          this.bus.emit("status", "no one here yet — share the code");
        }
      }, LONELY_AFTER_MS),
      window.setTimeout(() => {
        if (this.players.size === 0 && !this.left) {
          this.bus.emit(
            "status",
            "still alone — check the code or try one network",
          );
        }
      }, UNREACHABLE_AFTER_MS),
    );
  }

  private helloMsg(): HelloMsg {
    return {
      v: PROTOCOL_VERSION,
      name: this.identity.name,
      chartId: this.identity.chartId,
      chartHash: this.identity.chartHash,
      difficulty: this.identity.difficulty,
      character: this.identity.character,
      ready: this.localReady,
    };
  }

  private onHello(peerId: string, msg: HelloMsg): void {
    if (msg.v !== PROTOCOL_VERSION) {
      this.bus.emit(
        "status",
        `peer runs protocol v${msg.v}, we run v${PROTOCOL_VERSION}`,
      );
      return;
    }
    this.patch(peerId, {
      name: msg.name,
      ready: msg.ready,
      chartHash: msg.chartHash,
      difficulty: msg.difficulty,
      character: msg.character,
    });
    if (msg.chartHash !== this.identity.chartHash) {
      this.bus.emit("mismatch", { peerId, theirs: msg.chartHash });
    }
  }

  /** Upsert a peer field-wise; absent peers are ignored (late message). */
  private patch(peerId: string, fields: Partial<RemotePlayer>): void {
    const existing = this.players.get(peerId);
    if (!existing) return;
    this.players.set(peerId, { ...existing, ...fields });
    this.emitPeers();
  }

  private emitPeers(): void {
    this.bus.emit("peers", this.peers);
  }

  get peers(): readonly RemotePlayer[] {
    return [...this.players.values()];
  }

  get ready(): boolean {
    return this.localReady;
  }

  /** True once every connected peer agrees on the chart and is ready. */
  get allReady(): boolean {
    const peers = this.peers;
    if (peers.length === 0) return false;
    return (
      this.localReady &&
      peers.every((p) => p.ready && p.chartHash === this.identity.chartHash)
    );
  }

  /**
   * Announce a difficulty re-pick. Ready is deliberately *not* cleared: the
   * choice is ours alone and changing it doesn't alter what the peer agreed
   * to play.
   */
  setDifficulty(difficulty: string): void {
    if (difficulty === this.identity.difficulty) return;
    this.identity = { ...this.identity, difficulty };
    this.sendHello(this.helloMsg());
    this.emitPeers();
  }

  /**
   * Announce a track re-pick. Unlike difficulty, the chart *is* the
   * agreement: allReady requires every peer's chartHash to match ours, so
   * changing tracks blocks the start until the peer picks the same one.
   * Peers re-run their mismatch check on the fresh hello; we re-run ours
   * here against what they last announced.
   */
  setChart(chartId: string, chartHash: string): void {
    if (
      chartId === this.identity.chartId &&
      chartHash === this.identity.chartHash
    ) {
      return;
    }
    this.identity = { ...this.identity, chartId, chartHash };
    this.sendHello(this.helloMsg());
    for (const p of this.peers) {
      if (p.chartHash !== null && p.chartHash !== chartHash) {
        this.bus.emit("mismatch", { peerId: p.id, theirs: p.chartHash });
      }
    }
    this.emitPeers();
  }

  /** Announce an avatar re-pick; same non-agreement rules as difficulty. */
  setCharacter(character: string): void {
    if (character === this.identity.character) return;
    this.identity = { ...this.identity, character };
    this.sendHello(this.helloMsg());
    this.emitPeers();
  }

  setReady(ready: boolean): void {
    this.localReady = ready;
    this.sendReady({ ready });
    this.emitPeers();
  }

  /**
   * Host election without a handshake: lowest peer id wins. Trystero ids are
   * random per session, so this is stable for the room's lifetime and both
   * sides compute the same answer with no extra round trip.
   */
  get isHost(): boolean {
    return this.peers.every((p) => this.selfId < p.id);
  }

  /** Everyone's audio is decoded and unlocked. */
  get allArmed(): boolean {
    const peers = this.peers;
    return peers.length > 0 && peers.every((p) => p.armed);
  }

  setArmed(armed: boolean): void {
    this.sendArmed({ armed });
  }

  /** Announce the audio start; the caller schedules its own to match. */
  announceGo(inMs: number): void {
    this.sendGo({ inMs });
  }

  /**
   * Round-trip time to the opponent, ms. Returns null if the ping fails or
   * there is no peer — callers fall back to assuming zero latency, which
   * costs alignment accuracy but never blocks the start.
   */
  async pingPeer(): Promise<number | null> {
    const peer = this.peers[0];
    if (!peer) return null;
    try {
      return await this.room.ping(peer.id);
    } catch {
      return null;
    }
  }

  /** Tell peers to begin; the caller schedules its own start identically. */
  announceStart(inMs: number): StartMsg {
    const msg: StartMsg = {
      chartId: this.identity.chartId,
      chartHash: this.identity.chartHash,
      inMs,
    };
    this.sendStart(msg);
    return msg;
  }

  sendHit(msg: HitMsg): void {
    this.sendHitMsg(msg);
  }

  sendState(msg: StateMsg): void {
    this.sendStateMsg(msg);
  }

  sendFinish(msg: FinishMsg): void {
    this.sendFinishMsg(msg);
  }

  async leave(): Promise<void> {
    if (this.left) return;
    this.left = true;
    for (const timer of this.timers) window.clearTimeout(timer);
    this.timers.length = 0;
    this.players.clear();
    await this.room.leave();
  }
}

// Module-level singleton: the room outlives the lobby scene (it has to
// survive the switch into gameplay), and scenes are destroyed on every
// switch, so ownership can't live in one.
let active: NetRoom | null = null;

export function activeRoom(): NetRoom | null {
  return active;
}

// Closing the tab must announce the departure, otherwise the opponent stares
// at a live-looking ghost until the relay times the peer out. pagehide fires
// on close, navigation, and mobile backgrounding, where beforeunload doesn't.
// leave() is best-effort here: the browser won't wait for it.
let unloadHookInstalled = false;

function installUnloadHook(): void {
  if (unloadHookInstalled) return;
  unloadHookInstalled = true;
  window.addEventListener("pagehide", () => {
    void active?.leave();
  });
}

export async function joinNetRoom(
  code: string,
  identity: RoomIdentity,
): Promise<NetRoom> {
  await leaveNetRoom();
  installUnloadHook();
  active = new NetRoom(code, identity);
  return active;
}

export async function leaveNetRoom(): Promise<void> {
  const room = active;
  active = null;
  await room?.leave();
}
