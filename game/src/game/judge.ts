/**
 * Judgement: resolves key presses and releases against notes using the song
 * clock. Windows are ± seconds around each note's time (PLAN.md §5), scaled
 * per difficulty (core/difficulty.ts).
 *
 * Holds are judged in two halves: the **head** exactly like a tap, and the
 * **tail** when the key comes back up. Each half scores independently, so a
 * hold is worth two judgements and a player who catches the head but lets go
 * early keeps the head's points and loses the combo on the tail.
 */
export type Judgement = "perfect" | "great" | "good" | "miss";

export const WINDOWS: Readonly<Record<Exclude<Judgement, "miss">, number>> = {
  perfect: 0.045,
  great: 0.09,
  good: 0.135,
};

/**
 * Letting go this close to a hold's end still counts as riding it out.
 * Wider than the tap windows on purpose: the player is aiming at the end of
 * a bar they can see, not at an instant, and a late release costs nothing.
 */
export const HOLD_RELEASE_GRACE = 0.12;

export interface JudgedNote {
  /** Hit time in seconds of song time. */
  t: number;
  lane: number;
  /** Hold length in seconds; 0 for taps. */
  d: number;
  /** Head: null while the note is still open (unhit and not yet missed). */
  judgement: Judgement | null;
  /** Tail: always null for taps; null on a hold until it ends or breaks. */
  tail: Judgement | null;
  /** True while the key is down and the hold is still alive. */
  holding: boolean;
}

export function isHold(note: JudgedNote): boolean {
  return note.d > 0;
}

/** True once nothing more can happen to this note. */
export function isResolved(note: JudgedNote): boolean {
  return note.judgement !== null && (note.d === 0 || note.tail !== null);
}

/** Judgeable units a note contributes: a hold scores its head and its tail. */
export function noteWeight(note: JudgedNote): number {
  return isHold(note) ? 2 : 1;
}

/** One scored half of one note. Taps only ever produce a "head". */
export interface Resolution {
  note: JudgedNote;
  part: "head" | "tail";
  judgement: Judgement;
  /** Signed seconds (negative = early); null when nothing was pressed. */
  delta: number | null;
}

export class Judge {
  private readonly windows: Record<Exclude<Judgement, "miss">, number>;
  private readonly releaseGrace: number;

  constructor(
    private readonly notes: readonly JudgedNote[],
    windowScale = 1,
  ) {
    this.windows = {
      perfect: WINDOWS.perfect * windowScale,
      great: WINDOWS.great * windowScale,
      good: WINDOWS.good * windowScale,
    };
    this.releaseGrace = HOLD_RELEASE_GRACE * windowScale;
  }

  /**
   * Resolve a key press at `songTime`: the nearest open note in the lane
   * wins if it sits inside the widest window; otherwise the press is
   * ignored (no ghost-tap penalty, PLAN.md §5). Catching a hold's head puts
   * that hold in the "holding" state until `release`.
   */
  tryHit(lane: number, songTime: number): Resolution | null {
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
    if (best === null || bestAbs > this.windows.good) return null;
    const judgement =
      bestAbs <= this.windows.perfect
        ? "perfect"
        : bestAbs <= this.windows.great
          ? "great"
          : "good";
    best.judgement = judgement;
    if (isHold(best)) best.holding = true;
    return { note: best, part: "head", judgement, delta: songTime - best.t };
  }

  /**
   * Resolve a key release: the lane's live hold ends here. Releasing inside
   * the grace window completes it; anything earlier breaks it. Returns null
   * for a release with no hold under it (the common case — every tap).
   *
   * A broken hold stays broken: re-pressing the key can't re-grab it, which
   * keeps the head/tail pair to exactly two judgements.
   */
  release(lane: number, songTime: number): Resolution | null {
    const note = this.notes.find((n) => n.lane === lane && n.holding);
    if (!note) return null;
    note.holding = false;
    const end = note.t + note.d;
    const judgement = songTime >= end - this.releaseGrace ? "perfect" : "miss";
    note.tail = judgement;
    return { note, part: "tail", judgement, delta: songTime - end };
  }

  /**
   * Advance time: mark open notes past the widest window as missed, and
   * complete holds the player has ridden all the way to their end. Returns
   * every resolution produced, in note order.
   *
   * A missed hold head resolves the tail as a miss too — the player never
   * had the chance to hold it, and both halves have to be accounted for or
   * the song never reaches its judged-everything end condition.
   */
  sweep(songTime: number): Resolution[] {
    const out: Resolution[] = [];
    for (const note of this.notes) {
      if (note.judgement === null) {
        if (songTime - note.t <= this.windows.good) continue;
        note.judgement = "miss";
        out.push({ note, part: "head", judgement: "miss", delta: null });
        if (isHold(note)) {
          note.tail = "miss";
          out.push({ note, part: "tail", judgement: "miss", delta: null });
        }
        continue;
      }
      if (note.holding && songTime >= note.t + note.d) {
        note.holding = false;
        note.tail = "perfect";
        out.push({ note, part: "tail", judgement: "perfect", delta: 0 });
      }
    }
    return out;
  }
}
