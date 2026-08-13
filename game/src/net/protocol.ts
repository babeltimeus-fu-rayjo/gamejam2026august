/**
 * Wire protocol for "mirror play" multiplayer (PLAN.md §8).
 *
 * Both players run the same chart locally; the connection only carries
 * lightweight events. Nothing here is authoritative — a dropped or late
 * message only stales the opponent's ghost, never your own gameplay. That
 * is what makes versus feasible without a server.
 *
 * Kept free of PixiJS and game-scene imports so the net layer stays
 * testable and can't drag rendering into a message handler.
 */
import type { Judgement } from "../game/judge";

/** Bumped whenever a message shape changes; peers refuse to pair across it. */
export const PROTOCOL_VERSION = 1;

/**
 * Trystero namespaces the DataChannel by action name and caps each at 12
 * bytes, hence the terse names.
 */
export const ACTIONS = {
  hello: "hello",
  ready: "ready",
  start: "start",
  hit: "hit",
  state: "state",
  finish: "finish",
} as const;

/** First message each side sends on peer join; establishes identity + chart. */
export type HelloMsg = {
  v: number;
  name: string;
  chartId: string;
  /** Hash of the chart JSON — both sides must agree before starting. */
  chartHash: string;
  ready: boolean;
};

export type ReadyMsg = {
  ready: boolean;
};

/**
 * Host → peers, "begin in `inMs` milliseconds".
 *
 * Deliberately a *relative* delay rather than an absolute timestamp: wall
 * clocks between two machines can differ by seconds, while the one-way
 * message latency is tens of milliseconds. Each side schedules from its own
 * receipt time, so the error is bounded by latency instead of clock skew.
 */
export type StartMsg = {
  chartId: string;
  chartHash: string;
  inMs: number;
};

/** Per-hit event, mirrored to the opponent's ghost HUD. */
export type HitMsg = {
  /** Song time of the hit, seconds. */
  t: number;
  lane: number;
  judgement: Judgement;
  combo: number;
  score: number;
};

/** Periodic catch-up so a dropped `hit` can't desync the ghost readout. */
export type StateMsg = {
  combo: number;
  score: number;
  judged: number;
};

export type FinishMsg = {
  score: number;
  accuracy: number;
  maxCombo: number;
};

/** Room codes: unambiguous alphabet — no I/O/0/1 to survive being read aloud. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const ROOM_CODE_LENGTH = 4;

export function makeRoomCode(): string {
  const bytes = new Uint8Array(ROOM_CODE_LENGTH);
  crypto.getRandomValues(bytes);
  // Modulo bias is irrelevant here: 32 divides 256 exactly.
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join(
    "",
  );
}

/** Upper-cases and strips anything not in the alphabet (paste-friendly). */
export function normalizeRoomCode(raw: string): string {
  return raw
    .toUpperCase()
    .split("")
    .filter((c) => CODE_ALPHABET.includes(c))
    .join("")
    .slice(0, ROOM_CODE_LENGTH);
}

export function isCompleteRoomCode(code: string): boolean {
  return code.length === ROOM_CODE_LENGTH;
}

/**
 * FNV-1a over the raw chart text. Not cryptographic — it only needs to catch
 * "we're playing different charts", where any collision-resistant-enough
 * 32-bit digest does, without pulling in SubtleCrypto's async API.
 */
export function chartHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
