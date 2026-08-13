/**
 * Difficulties — three ways to play one authored chart.
 *
 * Songs ship a single `chart.json` (the NORMAL chart) and the other
 * difficulties are *derived* from it at load time. One chart per song means
 * one thing to author and one thing to keep in sync with the audio; a new
 * song gets all three difficulties for free.
 *
 * Each difficulty moves three dials:
 *  - **scroll speed** — how fast notes travel. EASY is slow, which is the
 *    single biggest readability win for a new player: notes stay on screen
 *    much longer and the eye has time to plan the next press.
 *  - **judgement windows** — scaled around the authored ±45/90/135 ms
 *    (`game/judge.ts`), so EASY forgives sloppy timing and HARD punishes it.
 *  - **note density** — EASY thins the chart to a minimum spacing and
 *    flattens chords to a single lane. Holds are never thinned away: they
 *    are the mechanic EASY most needs to teach.
 */
import type { Chart, Note } from "./beatmap";

export type DifficultyId = "easy" | "normal" | "hard";

/** Lobby cycling order, easiest first. */
export const DIFFICULTY_IDS: readonly DifficultyId[] = [
  "easy",
  "normal",
  "hard",
];

export interface Difficulty {
  id: DifficultyId;
  label: string;
  /** Note travel speed, px per second of song time. */
  scrollSpeed: number;
  /** Multiplier on every judgement window; >1 is more forgiving. */
  windowScale: number;
  /**
   * Minimum seconds between kept tap groups when thinning the chart.
   * 0 keeps every note (the chart as authored).
   */
  minGap: number;
  /** Cap on simultaneous notes; 4 leaves chords intact. */
  maxChord: number;
  /** Tint for the lobby row and the gameplay status line. */
  color: number;
  blurb: string;
}

export const DIFFICULTIES: Readonly<Record<DifficultyId, Difficulty>> = {
  easy: {
    id: "easy",
    label: "EASY",
    // ~0.6x normal: at 340 px/s a note is visible for about 1.8 s.
    scrollSpeed: 340,
    windowScale: 1.5,
    // Half a second between presses at most — on a 128 BPM chart this keeps
    // every other eighth and leaves a whole beat to move a finger.
    minGap: 0.7,
    maxChord: 1,
    color: 0x7cb583,
    blurb: "slower notes, fewer of them",
  },
  normal: {
    id: "normal",
    label: "NORMAL",
    scrollSpeed: 600,
    windowScale: 1,
    minGap: 0,
    maxChord: 4,
    color: 0xc7a763,
    blurb: "the chart as authored",
  },
  hard: {
    id: "hard",
    label: "HARD",
    scrollSpeed: 900,
    windowScale: 0.75,
    minGap: 0,
    maxChord: 4,
    color: 0xc9708e,
    blurb: "fast notes, tight timing",
  },
};

/** Step through DIFFICULTY_IDS, clamped at both ends (no wrap-around). */
export function stepDifficulty(id: DifficultyId, step: number): DifficultyId {
  const i = DIFFICULTY_IDS.indexOf(id);
  const next = Math.min(DIFFICULTY_IDS.length - 1, Math.max(0, i + step));
  return DIFFICULTY_IDS[next];
}

export function isDifficultyId(value: string): value is DifficultyId {
  return (DIFFICULTY_IDS as readonly string[]).includes(value);
}

/**
 * Display label for a difficulty that came off the wire, where a peer on
 * another build may name one we've never heard of. Falls back to showing
 * whatever they sent rather than hiding the disagreement.
 */
export function difficultyLabel(id: string | null): string {
  if (id === null) return "…";
  return isDifficultyId(id) ? DIFFICULTIES[id].label : id;
}

/** Notes sharing an exact time — a chord, or a single note. */
function groupByTime(notes: readonly Note[]): Note[][] {
  const groups: Note[][] = [];
  for (const note of notes) {
    const last = groups[groups.length - 1];
    if (last && last[0].t === note.t) last.push(note);
    else groups.push([note]);
  }
  return groups;
}

/**
 * Derive the playable chart for `difficulty` from the authored one. Pure:
 * the source chart and its notes are never mutated, so switching difficulty
 * in the lobby can re-derive from the same parsed chart.
 *
 * Thinning walks the chart in time order and keeps a group only once
 * `minGap` has elapsed since the last kept group. Two exceptions keep the
 * result playable and musical:
 *  - holds are kept unconditionally — they are the mechanic, and dropping
 *    one leaves the easiest difficulty never teaching it;
 *  - a lane occupied by a kept hold can't take another note until that hold
 *    ends, which is the only spacing constraint a *finger* actually cares
 *    about. Spacing between different lanes is just `minGap`.
 */
export function applyDifficulty(chart: Chart, difficulty: Difficulty): Chart {
  const { minGap, maxChord } = difficulty;
  if (minGap <= 0 && maxChord >= chart.lanes) return chart;

  const kept: Note[] = [];
  /** Per lane: song time at which a kept hold frees the lane again. */
  const laneFreeAt = new Array<number>(chart.lanes).fill(-Infinity);
  let lastKeptT = -Infinity;

  for (const group of groupByTime(chart.notes)) {
    const t = group[0].t;
    const holds = group.filter((n) => n.type === "hold");
    if (holds.length === 0 && t - lastKeptT < minGap) continue;

    // Chords collapse onto their lowest lanes, so the reduced chart still
    // reads left-to-right the way the author wrote it.
    const chosen = (holds.length > 0 ? holds : group)
      .filter((n) => t >= laneFreeAt[n.lane])
      .sort((a, b) => a.lane - b.lane)
      .slice(0, Math.max(1, maxChord));
    if (chosen.length === 0) continue;

    for (const n of chosen) {
      kept.push({ ...n });
      if (n.type === "hold") laneFreeAt[n.lane] = n.t + (n.d ?? 0);
    }
    lastKeptT = t;
  }

  return { ...chart, notes: kept };
}
