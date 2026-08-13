/**
 * Local player identity for multiplayer.
 *
 * Trystero peer ids are random per session and unreadable ("a7f3…"), which
 * makes both the lobby roster and the opponent HUD meaningless. A handle is
 * generated once and kept in localStorage so a player is recognisable across
 * reloads and rematches, with no account or server involved.
 */

const STORAGE_KEY = "rhythm.playerName";

// Matches the track's arcane lane palette rather than generic "Player 2".
const HANDLES = [
  "Rose",
  "Amethyst",
  "Jade",
  "Gold",
  "Ember",
  "Frost",
  "Ivy",
  "Onyx",
] as const;

const MAX_NAME_LENGTH = 16;

function randomHandle(): string {
  const bytes = new Uint8Array(2);
  crypto.getRandomValues(bytes);
  const word = HANDLES[bytes[0] % HANDLES.length];
  // Two digits keep collisions unlikely within a room without going noisy.
  return `${word}${(bytes[1] % 90) + 10}`;
}

/**
 * Stable handle for this browser. Falls back to a fresh per-session name if
 * storage is unavailable (private mode, blocked cookies) — a throwaway name
 * beats failing to join.
 */
export function playerName(): string {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return stored.slice(0, MAX_NAME_LENGTH);
    const name = randomHandle();
    localStorage.setItem(STORAGE_KEY, name);
    return name;
  } catch {
    return randomHandle();
  }
}
