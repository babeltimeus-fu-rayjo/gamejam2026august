import { Container, Graphics } from "pixi.js";
import { VIRTUAL_HEIGHT, VIRTUAL_WIDTH } from "../config";
import { NeonTunnel } from "./neon-tunnel";

/**
 * The menu background: neon tunnel plus the scrim that makes type legible on
 * top of it. Shared by the title screen and the lobby so both menus sit in the
 * same space — add it first, then the screen's own content over it.
 *
 * Music reactivity is optional: pass the Bgm's level/kick to `update` where a
 * track is playing, or nothing at all for an unreactive idle drift.
 */
export class NeonBackdrop extends Container {
  private readonly tunnel: NeonTunnel;

  constructor() {
    super();
    this.tunnel = new NeonTunnel({
      width: VIRTUAL_WIDTH,
      height: VIRTUAL_HEIGHT,
    });

    // The tunnel peaks near white, so the type needs something to sit on.
    const scrim = new Graphics()
      .rect(0, 0, VIRTUAL_WIDTH, VIRTUAL_HEIGHT)
      .fill({ color: 0x05030d, alpha: 0.32 });

    this.addChild(this.tunnel, scrim);
  }

  /** Advance one frame. `level` and `kick` are the Bgm fields, both 0..1. */
  update(dt: number, level = 0, kick = 0): void {
    this.tunnel.update(dt, level, kick);
  }
}
