/**
 * Game-wide constants. Scenes design against a fixed virtual canvas;
 * main.ts scales the root container to fit the real window (letterboxed).
 */
export const VIRTUAL_WIDTH = 1280;
export const VIRTUAL_HEIGHT = 720;

/** Chosen on the title screen; battle opens the multiplayer room UI. */
export type GameMode = "single" | "battle";

/**
 * The only song until lobby track select lands (M5). Lives here so the
 * lobby can hash its chart for multiplayer without importing gameplay.
 */
export const SONG_ID = "everyday-is-extraordinary";
export const SONG_DIR = `${import.meta.env.BASE_URL}songs/${SONG_ID}/`;

/** Page background (outside the virtual canvas). */
export const LETTERBOX_COLOR = 0x0e0a1a;
/** Virtual canvas backdrop. */
export const BACKDROP_COLOR = 0x151024;
