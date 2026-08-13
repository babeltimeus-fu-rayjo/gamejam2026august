/**
 * Lane input: physical keys D F J K (by e.code, so it survives non-QWERTY
 * layouts) mapped to lanes 0..3 left-to-right. Judgement must read the
 * clock inside the handler, so the callbacks fire synchronously from
 * keydown/keyup — never deferred to the next frame.
 *
 * Releases matter as much as presses now that holds are judged on both, so
 * this tracks which lanes are down and can force them up: a window that
 * loses focus mid-hold never delivers the keyup, and the hold would
 * otherwise complete itself for free while the player is elsewhere.
 */
const KEY_TO_LANE: Readonly<Record<string, number>> = {
  KeyD: 0,
  KeyF: 1,
  KeyJ: 2,
  KeyK: 3,
};

/** Receptor labels, index = lane. */
export const LANE_KEY_LABELS = ["D", "F", "J", "K"] as const;

export interface LaneHandlers {
  onPress: (lane: number) => void;
  onRelease: (lane: number) => void;
}

export class LaneInput {
  /** Lanes whose key is currently down. */
  private readonly held = new Set<number>();

  constructor(private readonly handlers: LaneHandlers) {}

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    const lane = KEY_TO_LANE[e.code];
    if (lane === undefined) return;
    this.held.add(lane);
    this.handlers.onPress(lane);
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    const lane = KEY_TO_LANE[e.code];
    if (lane === undefined || !this.held.delete(lane)) return;
    this.handlers.onRelease(lane);
  };

  private readonly onBlur = (): void => {
    this.releaseAll();
  };

  /** Lift every held key, as if the player let go right now. */
  releaseAll(): void {
    for (const lane of [...this.held]) {
      this.held.delete(lane);
      this.handlers.onRelease(lane);
    }
  }

  attach(): void {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
  }

  detach(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    this.held.clear();
  }
}
