/**
 * Judgement: resolves key presses against notes using the song clock.
 * Windows are ± seconds around each note's time (PLAN.md §5).
 */
export type Judgement = "perfect" | "great" | "good" | "miss";

export const WINDOWS: Readonly<Record<Exclude<Judgement, "miss">, number>> = {
  perfect: 0.045,
  great: 0.09,
  good: 0.135,
};

export interface JudgedNote {
  /** Hit time in seconds of song time. */
  t: number;
  lane: number;
  /** null while the note is still open (unhit and not yet missed). */
  judgement: Judgement | null;
}

export interface HitResult {
  note: JudgedNote;
  judgement: Exclude<Judgement, "miss">;
  /** Signed seconds; negative = early, positive = late. */
  delta: number;
}

export class Judge {
  constructor(private readonly notes: readonly JudgedNote[]) {}

  /**
   * Resolve a key press at `songTime`: the nearest open note in the lane
   * wins if it sits inside the widest window; otherwise the press is
   * ignored (no ghost-tap penalty, PLAN.md §5).
   */
  tryHit(lane: number, songTime: number): HitResult | null {
    let best: JudgedNote | null = null;
    let bestAbs = Infinity;
    for (const n of this.notes) {
      if (n.lane !== lane || n.judgement !== null) continue;
      const abs = Math.abs(n.t - songTime);
      if (abs < bestAbs) {
        best = n;
        bestAbs = abs;
      }
    }
    if (best === null || bestAbs > WINDOWS.good) return null;
    const judgement =
      bestAbs <= WINDOWS.perfect
        ? "perfect"
        : bestAbs <= WINDOWS.great
          ? "great"
          : "good";
    best.judgement = judgement;
    return { note: best, judgement, delta: songTime - best.t };
  }

  /** Mark open notes past the widest window as misses; returns them. */
  sweepMisses(songTime: number): JudgedNote[] {
    const missed: JudgedNote[] = [];
    for (const n of this.notes) {
      if (n.judgement === null && songTime - n.t > WINDOWS.good) {
        n.judgement = "miss";
        missed.push(n);
      }
    }
    return missed;
  }
}
