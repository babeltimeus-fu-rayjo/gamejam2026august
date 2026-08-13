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

/** Combo from which every hit reads EXTRAORDINARY; a miss resets it. */
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

export function tierFor(judgement: Judgement, combo: number): FeedbackTier {
  return judgement !== "miss" && combo >= EXTRAORDINARY_COMBO
    ? "extraordinary"
    : judgement;
}

/** Consecutive EXTRAORDINARY hits that earn a camera shake. */
export const SHAKE_STREAK = 5;
export const SHAKE_DURATION_MS = 500;
const SHAKE_AMPLITUDE_X = 14;
const SHAKE_AMPLITUDE_Y = 9;

/**
 * Camera offset `ageMs` into a shake, decaying to nothing at the end.
 *
 * Two incommensurable frequencies rather than random jitter: the motion is
 * frame-rate independent and repeatable, and it reads as a struck object
 * ringing out instead of per-frame noise.
 */
export function shakeOffset(ageMs: number): { x: number; y: number } {
  const t = Math.min(1, ageMs / SHAKE_DURATION_MS);
  const decay = (1 - t) ** 2;
  return {
    x: Math.sin(ageMs * 0.075) * SHAKE_AMPLITUDE_X * decay,
    y: Math.cos(ageMs * 0.051) * SHAKE_AMPLITUDE_Y * decay,
  };
}
