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

export interface CharacterDef {
  id: string;
  /** Display name (lobby avatar select). */
  name: string;
  /** Pose texture URL per reaction. */
  poses: Record<Reaction, string>;
  /** Native pose image size; placement/scale math. */
  sourceSize: { w: number; h: number };
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
};

export const GAL: CharacterDef = {
  id: "gal",
  name: "Gal",
  poses: poses("gal"),
  sourceSize: SOURCE_SIZE,
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
};

/** Selectable roster, in lobby cycle order. */
export const CHARACTERS: readonly CharacterDef[] = [TEAL, IDOL, GAL, KOUEN];
