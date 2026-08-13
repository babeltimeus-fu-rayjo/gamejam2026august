import type { FeedbackTier } from "./feedback";
import type { Judgement } from "./judge";

/** Points per judgement (PLAN.md §5). Score is pure judgement points. */
export const POINTS: Readonly<Record<Exclude<Judgement, "miss">, number>> = {
  perfect: 100,
  great: 60,
  good: 30,
};

// Life gauge — misses drain it, hits nurse it back a little. A long run
// of misses empties the gauge and fails the song (gameplay watches
// `dead`); recovery is slow enough that survival stays earned.
export const MAX_LIFE = 1000;
const LIFE_DRAIN_MISS = 30;
const LIFE_GAIN: Readonly<Record<Exclude<Judgement, "miss">, number>> = {
  perfect: 9,
  great: 6,
  good: 3,
};

export interface PlayResults {
  score: number;
  maxCombo: number;
  /** 0..1 — earned points over the chart's maximum. */
  accuracy: number;
  grade: string;
  counts: Record<Judgement, number>;
  /** Judgeable units, not notes: a hold counts twice (head + tail). */
  totalNotes: number;
}

/** Events flowing over the gameplay bus (core/events.ts). */
export type GameEvents = {
  judgement: {
    judgement: Judgement;
    /**
     * How the hit should *read* — the judgement, or "extraordinary" once the
     * streak is up. Derived once by gameplay so the popup, the lane zone and
     * the camera shake can never disagree about what the player just did.
     */
    tier: FeedbackTier;
    lane: number;
    /** Signed ms (negative = early); null for sweep misses. */
    deltaMs: number | null;
    combo: number;
    score: number;
    /** 0..MAX_LIFE after this judgement was applied. */
    life: number;
  };
};

export function gradeFor(accuracy: number): string {
  if (accuracy >= 0.95) return "S";
  if (accuracy >= 0.9) return "A";
  if (accuracy >= 0.8) return "B";
  if (accuracy >= 0.65) return "C";
  return "D";
}

export class ScoreState {
  score = 0;
  combo = 0;
  maxCombo = 0;
  life = MAX_LIFE;
  readonly counts: Record<Judgement, number> = {
    perfect: 0,
    great: 0,
    good: 0,
    miss: 0,
  };

  /**
   * @param totalNotes judgeable units in the chart — taps count once, holds
   * twice (`noteWeight` in judge.ts). A hold's tail is worth full points, so
   * the accuracy denominator has to include it or a clean run exceeds 100 %.
   */
  constructor(readonly totalNotes: number) {}

  apply(judgement: Judgement): void {
    this.counts[judgement] += 1;
    if (judgement === "miss") {
      this.combo = 0;
      this.life = Math.max(0, this.life - LIFE_DRAIN_MISS);
      return;
    }
    this.score += POINTS[judgement];
    this.life = Math.min(MAX_LIFE, this.life + LIFE_GAIN[judgement]);
    this.combo += 1;
    if (this.combo > this.maxCombo) this.maxCombo = this.combo;
  }

  /** True once the gauge is empty; the run fails at this point. */
  get dead(): boolean {
    return this.life <= 0;
  }

  get judgedCount(): number {
    const c = this.counts;
    return c.perfect + c.great + c.good + c.miss;
  }

  results(): PlayResults {
    const accuracy =
      this.totalNotes === 0 ? 1 : this.score / (100 * this.totalNotes);
    return {
      score: this.score,
      maxCombo: this.maxCombo,
      accuracy,
      grade: gradeFor(accuracy),
      counts: { ...this.counts },
      totalNotes: this.totalNotes,
    };
  }
}
