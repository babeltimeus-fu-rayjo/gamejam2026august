/**
 * Game-wide constants. Scenes design against a fixed virtual canvas;
 * main.ts scales the root container to fit the real window (letterboxed).
 */
export const VIRTUAL_WIDTH = 1280;
export const VIRTUAL_HEIGHT = 720;

/** Chosen on the title screen; battle opens the multiplayer room UI. */
export type GameMode = "single" | "battle";

/**
 * The playable tracks, in lobby cycling order. Lives here so the lobby can
 * hash a chart for multiplayer without importing gameplay. Titles are
 * duplicated from each chart.json on purpose: the TRACK row needs them
 * before any chart has been fetched.
 */
export interface SongDef {
  /** Folder name under public/songs/. */
  id: string;
  title: string;
}

export const SONGS: readonly SongDef[] = [
  { id: "everyday-is-extraordinary", title: "Everyday is extraordinary" },
  { id: "kirakira-idol", title: "キラキラアイドル" },
  { id: "okitsunesama", title: "おキツネさま" },
  { id: "warm-coffee-blues", title: "Warm Coffee Blues" },
  { id: "pridefall-boss", title: "Pridefall Boss" },
];

/** Where a song's chart.json and audio live, with the deploy base applied. */
export function songDir(id: string): string {
  return `${import.meta.env.BASE_URL}songs/${id}/`;
}

/** Page background (outside the virtual canvas). */
export const LETTERBOX_COLOR = 0x0e0a1a;
/** Virtual canvas backdrop. */
export const BACKDROP_COLOR = 0x151024;
