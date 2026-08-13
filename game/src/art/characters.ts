/**
 * Data-driven avatar characters. A character is just a set of pose textures
 * keyed by reaction; swapping the placeholder art (or adding a multiplayer
 * opponent) means adding another CharacterDef, no Avatar changes.
 */

export type Reaction =
  "idle" | "perfect" | "great" | "good" | "miss" | "comboBreak" | "hype";

export const REACTIONS: readonly Reaction[] = [
  "idle",
  "perfect",
  "great",
  "good",
  "miss",
  "comboBreak",
  "hype",
];

/**
 * Light per-character gameplay dials. Every field is optional and defaults
 * to neutral, so a character with no `perk` (Teal) plays exactly vanilla.
 * These compose with the difficulty's dials in gameplay.ts; they never
 * mutate a Difficulty.
 */
export interface CharacterPerk {
  /** Multiplies the difficulty's windowScale; >1 is more forgiving. */
  windowScale?: number;
  /** Multiplies the difficulty's lifeDrainMiss; <1 makes misses gentler. */
  lifeDrainScale?: number;
  /** Combo at which hits read EXTRAORDINARY (default in game/feedback.ts). */
  extraordinaryCombo?: number;
}

export interface CharacterDef {
  id: string;
  /** Display name (lobby avatar select). */
  name: string;
  /** Pose texture URL per reaction. */
  poses: Record<Reaction, string>;
  /** Native pose image size; placement/scale math. */
  sourceSize: { w: number; h: number };
  /** Signature color for player-owned chrome (combo, progress bar, lobby). */
  accent?: number;
  /** One-line perk description for the lobby's AVATAR row. */
  perkBlurb?: string;
  perk?: CharacterPerk;
}

/** Pose set for a character whose folder holds one file per reaction. */
function poses(dir: string): Record<Reaction, string> {
  const base = `${import.meta.env.BASE_URL}assets/avatars/${dir}/`;
  return {
    idle: `${base}idle.png`,
    perfect: `${base}perfect.png`,
    great: `${base}great.png`,
    good: `${base}good.png`,
    miss: `${base}miss.png`,
    comboBreak: `${base}combobreak.png`,
    hype: `${base}hype.png`,
  };
}

/** Every pose sheet is generated at this size. */
const SOURCE_SIZE = { w: 864, h: 1152 };

export const TEAL: CharacterDef = {
  id: "teal",
  name: "Teal",
  poses: poses("teal"),
  sourceSize: SOURCE_SIZE,
};

export const IDOL: CharacterDef = {
  id: "idol",
  name: "Idol",
  poses: poses("idol"),
  sourceSize: SOURCE_SIZE,
  accent: 0xff7ac2,
  perkBlurb: "early spotlight",
  // Presentation only: the EXTRAORDINARY streak (and its vignette/shake
  // rewards) ignites two hits sooner. Scoring never sees it.
  perk: { extraordinaryCombo: 8 },
};

export const GAL: CharacterDef = {
  id: "gal",
  name: "Gal",
  poses: poses("gal"),
  sourceSize: SOURCE_SIZE,
  accent: 0xffb84d,
  perkBlurb: "loose timing",
  // Slightly forgiving judgement windows, on top of the difficulty's scale.
  perk: { windowScale: 1.1 },
};

export const KOUEN: CharacterDef = {
  id: "kouen",
  name: "Kouen",
  poses: {
    ...poses("kouen"),
    // No dedicated miss pose yet — the shock frame stands in until one lands.
    miss: poses("kouen").comboBreak,
  },
  sourceSize: SOURCE_SIZE,
  accent: 0xe8483f,
  perkBlurb: "iron spirit",
  // Misses drain 20% less life; EASY's disabled gauge stays disabled.
  perk: { lifeDrainScale: 0.8 },
};

export const FEE: CharacterDef = {
  id: "fee",
  name: "Fee",
  poses: poses("fee"),
  sourceSize: SOURCE_SIZE,
  accent: 0x63c74d,
  perkBlurb: "deadeye focus",
  // Risk/reward sharpshooter: windows tighten 10%, but the EXTRAORDINARY
  // spotlight ignites four hits sooner for players who can hold the line.
  perk: { windowScale: 0.9, extraordinaryCombo: 6 },
};

export const ELARA: CharacterDef = {
  id: "elara",
  name: "Elara",
  poses: poses("elara"),
  sourceSize: SOURCE_SIZE,
  accent: 0x7fe0e8,
  perkBlurb: "death's bargain",
  // Misses drain 40% less life, paid for with slightly tighter windows.
  // Deeper trade than Kouen's flat 20%: survival bought with precision.
  perk: { lifeDrainScale: 0.6, windowScale: 0.95 },
};

export const EMMA: CharacterDef = {
  id: "emma",
  name: "Emma",
  poses: poses("emma"),
  sourceSize: SOURCE_SIZE,
  accent: 0x9457c9,
  perkBlurb: "high roller",
  // The house's favorite bet: the loosest windows on the roster, but every
  // miss drains 25% more life. Generous until the cards turn.
  perk: { windowScale: 1.15, lifeDrainScale: 1.25 },
};

/** Selectable roster, in lobby cycle order. */
export const CHARACTERS: readonly CharacterDef[] = [
  TEAL,
  IDOL,
  GAL,
  KOUEN,
  FEE,
  ELARA,
  EMMA,
];
