import type { Judgement } from "./judge";

/** Points per judgement (PLAN.md §5). Score is pure judgement points. */
export const POINTS: Readonly<Record<Exclude<Judgement, "miss">, number>> = {
  perfect: 100,
  great: 60,
  good: 30,
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
    lane: number;
    /** Signed ms (negative = early); null for sweep misses. */
    deltaMs: number | null;
    combo: number;
    score: number;
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
      return;
    }
    this.score += POINTS[judgement];
    this.combo += 1;
    if (this.combo > this.maxCombo) this.maxCombo = this.combo;
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
