import type { Judgement } from "../game/judge";
import type { Reaction } from "./characters";

/** Quiet time before the avatar drifts back to idle (kind-bell style). */
const IDLE_RETURN_MS = 3000;
/** A miss that breaks a combo at least this big reads as a shock. */
const COMBO_BREAK_AT = 15;
/** Every Nth combo triggers the hype pose over the per-note reaction. */
const HYPE_EVERY = 25;

/**
 * Maps judgement events to avatar reactions and decays back to idle.
 * Deliberately Pixi-free so a future cutin layer can reuse it verbatim.
 */
export class ReactionController {
  current: Reaction = "idle";
  /** Bumped on every reaction change; lets views detect swaps cheaply. */
  version = 0;

  private sinceReactionMs = Infinity;
  private prevCombo = 0;

  onJudgement(judgement: Judgement, combo: number): void {
    let next: Reaction;
    if (judgement === "miss") {
      next = this.prevCombo >= COMBO_BREAK_AT ? "comboBreak" : "miss";
    } else if (combo > 0 && combo % HYPE_EVERY === 0) {
      next = "hype";
    } else {
      next = judgement;
    }
    this.prevCombo = combo;
    this.sinceReactionMs = 0;
    if (next !== this.current) {
      this.current = next;
      this.version += 1;
    }
  }

  update(deltaMS: number): void {
    this.sinceReactionMs += deltaMS;
    if (this.current !== "idle" && this.sinceReactionMs >= IDLE_RETURN_MS) {
      this.current = "idle";
      this.version += 1;
    }
  }
}
