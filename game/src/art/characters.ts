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
  /** Pose texture URL per reaction. */
  poses: Record<Reaction, string>;
  /** Native pose image size; placement/scale math. */
  sourceSize: { w: number; h: number };
}

const TEAL_DIR = `${import.meta.env.BASE_URL}assets/avatars/teal/`;

export const TEAL: CharacterDef = {
  id: "teal",
  poses: {
    idle: `${TEAL_DIR}idle.png`,
    perfect: `${TEAL_DIR}perfect.png`,
    great: `${TEAL_DIR}great.png`,
    good: `${TEAL_DIR}good.png`,
    miss: `${TEAL_DIR}miss.png`,
    comboBreak: `${TEAL_DIR}combobreak.png`,
    hype: `${TEAL_DIR}hype.png`,
  },
  sourceSize: { w: 864, h: 1152 },
};
