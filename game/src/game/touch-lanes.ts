import { Container, Polygon } from "pixi.js";
import { VIRTUAL_HEIGHT } from "../config";
import type { LaneHandlers } from "../core/input";
import { laneEdgeXAt } from "./track";

/**
 * Top of the touchable lane columns. Above this the trapezoid narrows to
 * sliver-thin lanes (adjacent-lane misses), and the PAUSE / LOBBY buttons
 * live in the top-left corner.
 */
const TOUCH_TOP_Y = 220;

const LANES = 4;

/**
 * Multitouch lane input: four invisible, perspective-correct lane columns
 * that press/release lanes the way D F J K do. Each finger is its own
 * pointer: the lane locks at pointerdown and releases wherever that finger
 * lifts (Pixi fires `pointerupoutside` on the pointerdown target), so a
 * hold survives finger drift and never retargets mid-sustain.
 *
 * Handlers fire synchronously from the DOM pointer event — judging reads
 * the audio clock inside them, same contract as `LaneInput`.
 */
export class TouchLaneOverlay {
  readonly view = new Container();

  /** pointerId → lane locked at pointerdown. */
  private readonly pointerLanes = new Map<number, number>();

  constructor(private readonly handlers: LaneHandlers) {
    for (let lane = 0; lane < LANES; lane++) {
      const quad = new Container();
      quad.eventMode = "static";
      // Hit-area-only: nothing renders, nothing joins the draw list. The
      // column runs past the hit line to the screen edge so thumbs resting
      // below the receptors still register.
      quad.hitArea = new Polygon([
        laneEdgeXAt(lane, TOUCH_TOP_Y),
        TOUCH_TOP_Y,
        laneEdgeXAt(lane + 1, TOUCH_TOP_Y),
        TOUCH_TOP_Y,
        laneEdgeXAt(lane + 1, VIRTUAL_HEIGHT),
        VIRTUAL_HEIGHT,
        laneEdgeXAt(lane, VIRTUAL_HEIGHT),
        VIRTUAL_HEIGHT,
      ]);
      quad.on("pointerdown", (e) => this.press(e.pointerId, lane));
      quad.on("pointerup", (e) => this.lift(e.pointerId));
      quad.on("pointerupoutside", (e) => this.lift(e.pointerId));
      // The OS stole the touch (notification shade, palm rejection): break
      // the hold honestly instead of letting it complete for free.
      quad.on("pointercancel", (e) => this.lift(e.pointerId));
      this.view.addChild(quad);
    }
  }

  private press(pointerId: number, lane: number): void {
    if (this.pointerLanes.has(pointerId)) return;
    this.pointerLanes.set(pointerId, lane);
    this.handlers.onPress(lane);
  }

  private lift(pointerId: number): void {
    const lane = this.pointerLanes.get(pointerId);
    if (lane === undefined) return;
    this.pointerLanes.delete(pointerId);
    this.handlers.onRelease(lane);
  }

  /** Lift every finger, as if the player let go now (pause/blur parity). */
  releaseAll(): void {
    const lanes = [...this.pointerLanes.values()];
    this.pointerLanes.clear();
    for (const lane of lanes) this.handlers.onRelease(lane);
  }
}
