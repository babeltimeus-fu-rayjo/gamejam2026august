/**
 * Game-wide constants. Scenes design against a fixed virtual canvas;
 * main.ts scales the root container to fit the real window (letterboxed).
 */
export const VIRTUAL_WIDTH = 1280;
export const VIRTUAL_HEIGHT = 720;

/** Chosen on the title screen; battle is a stub until multiplayer (M6). */
export type GameMode = "single" | "battle";

/** Page background (outside the virtual canvas). */
export const LETTERBOX_COLOR = 0x0e0a1a;
/** Virtual canvas backdrop. */
export const BACKDROP_COLOR = 0x151024;
