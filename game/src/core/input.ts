/**
 * Lane input: physical keys D F J K (by e.code, so it survives non-QWERTY
 * layouts) mapped to lanes 0..3 left-to-right. Judgement must read the
 * clock inside the handler, so the callback fires synchronously from
 * keydown — never deferred to the next frame.
 */
const KEY_TO_LANE: Readonly<Record<string, number>> = {
  KeyD: 0,
  KeyF: 1,
  KeyJ: 2,
  KeyK: 3,
};

/** Receptor labels, index = lane. */
export const LANE_KEY_LABELS = ["D", "F", "J", "K"] as const;

export class LaneInput {
  constructor(private readonly onLane: (lane: number) => void) {}

  private readonly handler = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    const lane = KEY_TO_LANE[e.code];
    if (lane !== undefined) this.onLane(lane);
  };

  attach(): void {
    window.addEventListener("keydown", this.handler);
  }

  detach(): void {
    window.removeEventListener("keydown", this.handler);
  }
}
