import type { Emitter } from "../core/events";
import type { GameEvents, PlayResults } from "../game/score";
import type { NetRoom } from "./room";

/**
 * Forwards local gameplay onto the wire — the "multiplayer becomes 'forward
 * these events to a peer'" case that core/events.ts was built for.
 *
 * Nothing here can affect local play: it only reads the gameplay bus. If the
 * connection is dead, sends are dropped and the opponent's ghost stales.
 */

/**
 * Periodic catch-up cadence. Hits are the real signal; this only exists so a
 * dropped message can't leave the opponent's readout permanently wrong.
 */
const STATE_INTERVAL_MS = 1000;

export interface StateSnapshot {
  combo: number;
  score: number;
  judged: number;
}

export class GameplayRelay {
  private readonly offJudgement: () => void;
  private sinceStateMs = 0;

  constructor(
    private readonly room: NetRoom,
    bus: Emitter<GameEvents>,
    songTime: () => number,
  ) {
    this.offJudgement = bus.on(
      "judgement",
      ({ lane, judgement, combo, score }) => {
        this.room.sendHit({ t: songTime(), lane, judgement, combo, score });
      },
    );
  }

  /** Call once per frame; sends a state message at STATE_INTERVAL_MS. */
  tick(deltaMS: number, snapshot: StateSnapshot): void {
    this.sinceStateMs += deltaMS;
    if (this.sinceStateMs < STATE_INTERVAL_MS) return;
    this.sinceStateMs = 0;
    this.room.sendState(snapshot);
  }

  /**
   * `difficulty` rides along because scores aren't comparable across it —
   * the results screen needs to say which one the opponent played.
   */
  finish(results: PlayResults, difficulty: string): void {
    this.room.sendFinish({
      score: results.score,
      accuracy: results.accuracy,
      maxCombo: results.maxCombo,
      difficulty,
    });
  }

  dispose(): void {
    this.offJudgement();
  }
}
