/**
 * Beatmap (chart) format — the contract between charts on disk, the
 * gameplay code, and (later) the multiplayer chart-hash check.
 * One folder per song under public/songs/<id>/ holding the audio file,
 * chart.json, and cover art. See PLAN.md §4.
 */

export interface SongMeta {
  title: string;
  artist: string;
  /** Audio filename inside the song folder, e.g. "song.mp3". */
  audioFile: string;
  /** Song length in seconds; drives the progress bar and results. */
  duration: number;
}

export type NoteType = "tap" | "hold";

export interface Note {
  /** Hit time in seconds from audio start. */
  t: number;
  /** 0-based lane index; lane 0 is the top lane. */
  lane: number;
  type: NoteType;
  /** Hold duration in seconds; required when type is "hold". */
  d?: number;
}

export interface Chart {
  version: 1;
  song: SongMeta;
  /** Authoring metadata (quantize grid); gameplay uses absolute times. */
  bpm: number;
  /** Seconds from audio start to beat 0. */
  offset: number;
  lanes: number;
  /** Sorted by t ascending (parseChart guarantees this). */
  notes: Note[];
}

/**
 * Validate raw JSON into a Chart. Throws with a specific message on the
 * first problem found, so bad charts fail loudly at load time instead of
 * as NaN positions mid-song.
 */
export function parseChart(data: unknown): Chart {
  const chart = data as Chart;
  if (typeof chart !== "object" || chart === null) {
    throw new Error("chart: not an object");
  }
  if (chart.version !== 1) {
    throw new Error(`chart: unsupported version ${String(chart.version)}`);
  }
  const song = chart.song;
  if (
    typeof song !== "object" ||
    song === null ||
    typeof song.title !== "string" ||
    typeof song.artist !== "string" ||
    typeof song.audioFile !== "string" ||
    !(typeof song.duration === "number" && song.duration > 0)
  ) {
    throw new Error("chart: invalid song block");
  }
  if (!(typeof chart.bpm === "number" && chart.bpm > 0)) {
    throw new Error("chart: bpm must be a positive number");
  }
  if (typeof chart.offset !== "number") {
    throw new Error("chart: offset must be a number");
  }
  if (!(Number.isInteger(chart.lanes) && chart.lanes > 0)) {
    throw new Error("chart: lanes must be a positive integer");
  }
  if (!Array.isArray(chart.notes)) {
    throw new Error("chart: notes must be an array");
  }
  chart.notes.forEach((n, i) => {
    const ok =
      typeof n === "object" &&
      n !== null &&
      typeof n.t === "number" &&
      n.t >= 0 &&
      Number.isInteger(n.lane) &&
      n.lane >= 0 &&
      n.lane < chart.lanes &&
      (n.type === "tap" ||
        (n.type === "hold" && typeof n.d === "number" && n.d > 0));
    if (!ok) throw new Error(`chart: invalid note at index ${i}`);
  });
  chart.notes.sort((a, b) => a.t - b.t);
  return chart;
}
