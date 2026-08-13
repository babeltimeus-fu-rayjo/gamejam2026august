import { Assets, Container, Sprite, Texture, Ticker } from "pixi.js";
import { VIRTUAL_HEIGHT } from "../config";
import type { Emitter } from "../core/events";
import type { GameEvents } from "../game/score";
import type { CharacterDef, Reaction } from "./characters";
import { ReactionController } from "./reactions";

/** Gutter centers: track spans x 440..840 on the 1280-wide virtual canvas. */
const SIDE_X: Record<"left" | "right", number> = { left: 220, right: 1060 };
/** Feet sit slightly below the frame (kind-bell BASE_Y) so they never float. */
const BASE_Y = VIRTUAL_HEIGHT + 8;

const DEFAULT_HEIGHT = 460;
const BREATHE_PERIOD_MS = 2100;
const BREATHE_AMP_PX = 4;
const POP_MS = 140;
const SHAKE_MS = 250;
const SHAKE_AMP_PX = 3;

export interface AvatarOptions {
  side: "left" | "right";
  character: CharacterDef;
  bus: Emitter<GameEvents>;
  /** Display height in virtual px. */
  height?: number;
}

/**
 * Side-of-track reactive character. Placement lives on `view`, all motion on
 * an inner container, and reaction logic in ReactionController — so a future
 * opponent instance (side: "left") or cutin layer reuses the pieces as-is.
 */
export class Avatar {
  readonly view = new Container();

  private readonly controller = new ReactionController();
  private readonly unsubscribe: () => void;
  private readonly character: CharacterDef;
  private readonly baseScale: number;

  private inner: Container | null = null;
  private sprite: Sprite | null = null;
  private disposed = false;

  private shownVersion = 0;
  private elapsedMs = 0;
  private popMs = Infinity;
  private shakeMs = Infinity;

  /** Warm the Assets cache at boot so gameplay entry is instant. */
  static preload(character: CharacterDef): Promise<unknown> {
    return Assets.load(Object.values(character.poses));
  }

  constructor(opts: AvatarOptions) {
    this.character = opts.character;
    this.baseScale =
      (opts.height ?? DEFAULT_HEIGHT) / opts.character.sourceSize.h;
    this.view.position.set(SIDE_X[opts.side], BASE_Y);
    this.unsubscribe = opts.bus.on("judgement", (e) => {
      this.controller.onJudgement(e.judgement, e.combo);
    });
    void this.build();
  }

  private async build(): Promise<void> {
    await Avatar.preload(this.character);
    // The scene (and this.view) may have been destroyed while loading.
    if (this.disposed) return;
    this.sprite = new Sprite({
      texture: this.texture(this.controller.current),
      anchor: { x: 0.5, y: 1 },
    });
    this.inner = new Container();
    this.inner.addChild(this.sprite);
    this.inner.scale.set(this.baseScale);
    this.view.addChild(this.inner);
    this.shownVersion = this.controller.version;
  }

  private texture(reaction: Reaction): Texture {
    return Assets.get<Texture>(this.character.poses[reaction]);
  }

  update(ticker: Ticker): void {
    this.controller.update(ticker.deltaMS);
    if (!this.inner || !this.sprite) return;
    this.elapsedMs += ticker.deltaMS;

    if (this.controller.version !== this.shownVersion) {
      this.shownVersion = this.controller.version;
      const reaction = this.controller.current;
      this.sprite.texture = this.texture(reaction);
      if (reaction !== "idle") {
        this.popMs = 0;
        if (reaction === "miss" || reaction === "comboBreak") this.shakeMs = 0;
      }
    }

    // Idle breathe: gentle bob + 1% scale pulse, always on.
    const breathe = Math.sin(
      (this.elapsedMs / BREATHE_PERIOD_MS) * Math.PI * 2,
    );
    let scale = this.baseScale * (1 + 0.01 * breathe);
    let x = 0;
    const y = breathe * BREATHE_AMP_PX;

    // Reaction pop: quick out-and-back scale bump on pose swaps.
    if (this.popMs < POP_MS) {
      this.popMs += ticker.deltaMS;
      const t = Math.min(this.popMs / POP_MS, 1);
      scale *= 1 + 0.05 * Math.sin(t * Math.PI);
    }

    // Miss shake: decaying horizontal wobble.
    if (this.shakeMs < SHAKE_MS) {
      this.shakeMs += ticker.deltaMS;
      const t = Math.min(this.shakeMs / SHAKE_MS, 1);
      x = Math.sin(t * Math.PI * 4) * SHAKE_AMP_PX * (1 - t);
    }

    this.inner.scale.set(scale);
    this.inner.position.set(x, y);
  }

  /** Unhook the bus; the SceneManager destroys `view` itself. */
  dispose(): void {
    this.disposed = true;
    this.unsubscribe();
  }
}
