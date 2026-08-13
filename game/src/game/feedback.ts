/**
 * One palette for every piece of hit feedback, so the popup, the lane's
 * reaction pad, the rising light column and the burst all say the same thing
 * at once: green GREAT, yellow PERFECT, purple EXTRAORDINARY, red MISS.
 *
 * EXTRAORDINARY is presentation-only — it is what a PERFECT/GREAT/GOOD reads
 * as while a long streak is alive. Judgement windows and scoring never see it.
 */
import type { Judgement } from "./judge";

export type FeedbackTier = Judgement | "extraordinary";

/**
 * Default combo from which every hit reads EXTRAORDINARY; a miss resets it.
 * Characters may override the threshold (art/characters.ts CharacterPerk).
 */
export const EXTRAORDINARY_COMBO = 10;

export const TIER_COLOR: Readonly<Record<FeedbackTier, number>> = {
  extraordinary: 0xb05cff,
  perfect: 0xffd75c,
  great: 0x5ce08a,
  // Unspecified by the brief: a cool cyan, the one hue left that reads apart
  // from the four the player is being taught.
  good: 0x59c8e0,
  miss: 0xff4d5e,
};

export function tierFor(
  judgement: Judgement,
  combo: number,
  threshold: number = EXTRAORDINARY_COMBO,
): FeedbackTier {
  return judgement !== "miss" && combo >= threshold
    ? "extraordinary"
    : judgement;
}

/** Consecutive EXTRAORDINARY hits that earn a camera shake. */
export const SHAKE_STREAK = 5;
export const SHAKE_DURATION_MS = 500;
const SHAKE_AMPLITUDE_X = 14;
const SHAKE_AMPLITUDE_Y = 9;

/**
 * Per-hit camera punch: a single frame-and-a-half knock on a strong hit, on top
 * of whatever streak shake is running. Small enough to stack with a note every
 * eighth without turning the screen into soup — it is felt, not watched.
 */
export const PUNCH_DURATION_MS = 110;
export const PUNCH_AMPLITUDE = 0.3;
/** Tiers worth a punch: the ones the player is trying to hit. */
export function punchesCamera(tier: FeedbackTier): boolean {
  return tier === "perfect" || tier === "extraordinary";
}

/**
 * Letting go of a hold the player rode all the way out. Longer and heavier than
 * a tap's punch: the release is the payoff for seconds of sustain, and it lands
 * as the lane's light and spark spray drop away.
 */
export const HOLD_RELEASE_SHAKE_MS = 220;
export const HOLD_RELEASE_AMPLITUDE = 0.6;

/**
 * Camera offset `ageMs` into a shake, decaying to nothing at the end.
 *
 * Two incommensurable frequencies rather than random jitter: the motion is
 * frame-rate independent and repeatable, and it reads as a struck object
 * ringing out instead of per-frame noise.
 *
 * @param durationMs how long the shake rings out over. The default is the
 * gameplay streak kick; a single impact (the results screen's grade stamp)
 * passes a shorter one, which reads as a harder, drier knock.
 * @param amplitude scales the travel; the per-hit punch uses a fraction of the
 * streak shake so the two can be summed without fighting each other.
 */
export function shakeOffset(
  ageMs: number,
  durationMs: number = SHAKE_DURATION_MS,
  amplitude = 1,
): { x: number; y: number } {
  const t = Math.min(1, ageMs / durationMs);
  const decay = (1 - t) ** 2 * amplitude;
  return {
    x: Math.sin(ageMs * 0.075) * SHAKE_AMPLITUDE_X * decay,
    y: Math.cos(ageMs * 0.051) * SHAKE_AMPLITUDE_Y * decay,
  };
}
