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
  type FinishMsg,
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

export interface RemotePlayer {
  id: string;
  name: string;
  ready: boolean;
  /** null until their hello lands. */
  chartHash: string | null;
  /** Their chosen difficulty; null until their hello lands. May differ. */
  difficulty: string | null;
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
  private readonly sendHitMsg: (msg: HitMsg) => void;
  private readonly sendStateMsg: (msg: StateMsg) => void;
  private readonly sendFinishMsg: (msg: FinishMsg) => void;
  private lonelyTimer: number | null = null;

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
        chartHash: null,
        difficulty: null,
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
    this.lonelyTimer = window.setTimeout(() => {
      if (this.players.size === 0 && !this.left) {
        this.bus.emit("status", "no one here yet — share the code");
      }
    }, LONELY_AFTER_MS);
  }

  private helloMsg(): HelloMsg {
    return {
      v: PROTOCOL_VERSION,
      name: this.identity.name,
      chartId: this.identity.chartId,
      chartHash: this.identity.chartHash,
      difficulty: this.identity.difficulty,
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

  setReady(ready: boolean): void {
    this.localReady = ready;
    this.sendReady({ ready });
    this.emitPeers();
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
    if (this.lonelyTimer !== null) window.clearTimeout(this.lonelyTimer);
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

export async function joinNetRoom(
  code: string,
  identity: RoomIdentity,
): Promise<NetRoom> {
  await leaveNetRoom();
  active = new NetRoom(code, identity);
  return active;
}

export async function leaveNetRoom(): Promise<void> {
  const room = active;
  active = null;
  await room?.leave();
}
