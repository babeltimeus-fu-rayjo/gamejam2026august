import {
  Assets,
  Container,
  Graphics,
  GraphicsContext,
  Sprite,
  Texture,
} from "pixi.js";
import { TIER_COLOR, type FeedbackTier } from "./feedback";

/**
 * Painted hit effects for the reaction zone: one illustrated flash per tier,
 * stretched over the lane's pad, plus a spray of sparks in the tier's colour.
 *
 * The art arrives as a glow on white paper; `tools/key-vfx-white.py` keys the
 * paper out and crops each image to its own bounds, so a texture's extent *is*
 * its effect and additive blending can carry it — no white box, and the paint's
 * own brightness lives in its alpha.
 */

const VFX_DIR = `${import.meta.env.BASE_URL}assets/vfx/`;

/** MISS gets no flash — the zone already goes red — and GOOD keeps the plain bloom. */
const FLASH_URL: Partial<Record<FeedbackTier, string>> = {
  perfect: `${VFX_DIR}hit-perfect.png`,
  great: `${VFX_DIR}hit-great.png`,
  extraordinary: `${VFX_DIR}hit-extraordinary.png`,
};

/** True for tiers with painted art, which replaces the plain white bloom. */
export function hasPaintedFlash(tier: FeedbackTier): boolean {
  return FLASH_URL[tier] !== undefined;
}

// Flash timing: a hard arrival that overshoots the pad, then a fast decay. Short
// on purpose — the next note is usually a fraction of a second behind.
const FLASH_DURATION_MS = 300;
const FLASH_ATTACK = 0.14; // fraction of the life spent fading in
const FLASH_POP_IN = 0.8; // scale it starts at
const FLASH_POP_PEAK = 1.14; // overshoot before settling to 1
const FLASH_POP_AT = 0.24; // fraction of the life the peak lands on
/** Extra wobble per hit, so a stream of notes doesn't stamp one frozen image. */
const FLASH_TILT = 0.035;

// Sparks: sparse, fast, and gone. They read as debris thrown off the pad, which
// is what sells the hit as an impact rather than a light switch.
const SPARK_MIN = 9;
const SPARK_PER_STRENGTH = 9;
const SPARK_SPEED_MIN = 160;
const SPARK_SPEED_MAX = 440;
/** Sideways stretch / vertical squash: the pad is wide, so the spray is too. */
const SPARK_SPREAD_X = 1.6;
const SPARK_SPREAD_Y = 0.9;
/** Every spark gets some lift, so the spray rises before it falls. */
const SPARK_LIFT = 70;
const SPARK_GRAVITY = 620;
const SPARK_DRAG_PER_MS = 0.9945;
const SPARK_LIFE_MIN_MS = 340;
const SPARK_LIFE_MAX_MS = 640;
/** Hard ceiling on live sparks; a dense chart must not turn into a snowstorm. */
const MAX_SPARKS = 240;

/** Soft dot: bright core in a dim halo, so it glows without a texture fetch. */
const SPARK_CONTEXT = new GraphicsContext()
  .circle(0, 0, 6)
  .fill({ color: 0xffffff, alpha: 0.2 })
  .circle(0, 0, 3.2)
  .fill({ color: 0xffffff, alpha: 0.55 })
  .circle(0, 0, 1.6)
  .fill(0xffffff);

interface Flash {
  sprite: Sprite;
  ageMs: number;
  width: number;
  height: number;
  peakAlpha: number;
}

interface Spark {
  sprite: Graphics;
  ageMs: number;
  lifeMs: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  scale: number;
}

export interface HitFxOptions {
  tier: FeedbackTier;
  /** Centre of the lane's reaction pad. */
  x: number;
  y: number;
  /** Size the flash is stretched to; the art's radiance overflows it by design. */
  width: number;
  height: number;
  /** 0..1 hit quality — drives size, brightness and spark count. */
  strength: number;
}

export interface SparkOptions {
  /** Spark tint; callers outside a judgement pass a colour directly. */
  color: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** 0..1 — speed and size of the spray. */
  strength: number;
  /** How many to throw. Clamped by the live-spark ceiling. */
  count: number;
}

export class HitFx {
  readonly view = new Container();

  private readonly flashes: Flash[] = [];
  private readonly flashPool: Sprite[] = [];
  private readonly sparks: Spark[] = [];
  private readonly sparkPool: Graphics[] = [];
  /** Sparks over the flash: the debris reads as being thrown toward the player. */
  private readonly flashLayer = new Container();
  private readonly sparkLayer = new Container();

  /** Warm the flash textures while the chart is still loading. */
  static preload(): Promise<unknown> {
    return Promise.all(
      Object.values(FLASH_URL).map((url) =>
        Assets.load(url).catch(() => undefined),
      ),
    );
  }

  constructor() {
    this.view.addChild(this.flashLayer, this.sparkLayer);
  }

  /** Fire the tier's effect over one lane's pad. */
  play({ tier, x, y, width, height, strength }: HitFxOptions): void {
    this.playFlash(tier, x, y, width, height, strength);
    this.playSparks(tier, x, y, width, height, strength);
  }

  private playFlash(
    tier: FeedbackTier,
    x: number,
    y: number,
    width: number,
    height: number,
    strength: number,
  ): void {
    const url = FLASH_URL[tier];
    if (!url) return;
    // Cache-only: a texture still in flight simply skips a frame of art rather
    // than dropping a promise into the middle of gameplay.
    const texture = Assets.cache.get<Texture>(url);
    if (!texture) return;

    let sprite = this.flashPool.pop();
    if (!sprite) {
      sprite = new Sprite();
      sprite.anchor.set(0.5);
      sprite.blendMode = "add";
      this.flashLayer.addChild(sprite);
    }
    sprite.texture = texture;
    sprite.position.set(x, y);
    sprite.visible = true;
    sprite.rotation = (Math.random() * 2 - 1) * FLASH_TILT;
    // Mirroring costs nothing and stops repeated hits looking rubber-stamped.
    // It has to go through the scale's *sign*: the width setter takes a
    // magnitude and keeps whichever sign the sprite already had.
    sprite.scale.x = Math.random() < 0.5 ? -1 : 1;

    const size = 0.86 + 0.2 * strength;
    this.flashes.push({
      sprite,
      ageMs: 0,
      width: width * size,
      height: height * size,
      peakAlpha: 0.72 + 0.28 * strength,
    });
    // First frame at full pose, so a hit is never a blank frame.
    this.layoutFlash(this.flashes[this.flashes.length - 1]);
  }

  private playSparks(
    tier: FeedbackTier,
    x: number,
    y: number,
    width: number,
    height: number,
    strength: number,
  ): void {
    if (strength <= 0) return;
    this.spray({
      color: TIER_COLOR[tier],
      x,
      y,
      width,
      height,
      strength,
      count: Math.round(SPARK_MIN + SPARK_PER_STRENGTH * strength),
    });
  }

  /**
   * Throw `count` sparks from a pad-sized area. Public so a sustained effect —
   * a hold being ridden — can keep feeding the same spray a few at a time
   * instead of firing one judgement-sized burst.
   */
  spray({ color, x, y, width, height, strength, count }: SparkOptions): void {
    for (let i = 0; i < count; i++) {
      if (this.sparks.length >= MAX_SPARKS) return;
      let sprite = this.sparkPool.pop();
      if (!sprite) {
        sprite = new Graphics(SPARK_CONTEXT);
        sprite.blendMode = "add";
        this.sparkLayer.addChild(sprite);
      }
      sprite.tint = color;
      sprite.visible = true;

      const angle = Math.random() * Math.PI * 2;
      const speed =
        (SPARK_SPEED_MIN +
          Math.random() * (SPARK_SPEED_MAX - SPARK_SPEED_MIN)) *
        (0.7 + 0.5 * strength);
      const spark: Spark = {
        sprite,
        ageMs: 0,
        lifeMs:
          SPARK_LIFE_MIN_MS +
          Math.random() * (SPARK_LIFE_MAX_MS - SPARK_LIFE_MIN_MS),
        // Born across the pad, not from one point: the whole slab was struck.
        x: x + (Math.random() * 2 - 1) * width * 0.22,
        y: y + (Math.random() * 2 - 1) * height * 0.12,
        vx: Math.cos(angle) * speed * SPARK_SPREAD_X,
        vy: Math.sin(angle) * speed * SPARK_SPREAD_Y - SPARK_LIFT,
        scale: (0.5 + Math.random() * 0.7) * (0.8 + 0.4 * strength),
      };
      this.sparks.push(spark);
      sprite.position.set(spark.x, spark.y);
      sprite.scale.set(spark.scale);
      sprite.alpha = 1;
    }
  }

  update(deltaMs: number): void {
    const dt = deltaMs / 1000;

    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const flash = this.flashes[i];
      flash.ageMs += deltaMs;
      if (flash.ageMs >= FLASH_DURATION_MS) {
        flash.sprite.visible = false;
        this.flashPool.push(flash.sprite);
        this.flashes.splice(i, 1);
        continue;
      }
      this.layoutFlash(flash);
    }

    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const spark = this.sparks[i];
      spark.ageMs += deltaMs;
      const p = spark.ageMs / spark.lifeMs;
      if (p >= 1) {
        spark.sprite.visible = false;
        this.sparkPool.push(spark.sprite);
        this.sparks.splice(i, 1);
        continue;
      }
      // Drag then gravity: sparks shoot out, stall, and drop.
      const drag = SPARK_DRAG_PER_MS ** deltaMs;
      spark.vx *= drag;
      spark.vy = spark.vy * drag + SPARK_GRAVITY * dt;
      spark.x += spark.vx * dt;
      spark.y += spark.vy * dt;
      spark.sprite.position.set(spark.x, spark.y);
      spark.sprite.alpha = (1 - p) ** 1.5;
      spark.sprite.scale.set(spark.scale * (1 - 0.75 * p));
    }
  }

  /** Pop, settle, fade — the flash's whole pose for its current age. */
  private layoutFlash(flash: Flash): void {
    const p = flash.ageMs / FLASH_DURATION_MS;
    let pop: number;
    if (p <= FLASH_POP_AT) {
      // Ease-out to the overshoot: the arrival is the frame that must land hard.
      const k = 1 - (1 - p / FLASH_POP_AT) ** 2;
      pop = FLASH_POP_IN + (FLASH_POP_PEAK - FLASH_POP_IN) * k;
    } else {
      const k = (p - FLASH_POP_AT) / (1 - FLASH_POP_AT);
      pop = FLASH_POP_PEAK - (FLASH_POP_PEAK - 1) * k;
    }
    flash.sprite.width = flash.width * pop;
    flash.sprite.height = flash.height * pop;
    flash.sprite.alpha =
      flash.peakAlpha *
      (p <= FLASH_ATTACK
        ? p / FLASH_ATTACK
        : (1 - (p - FLASH_ATTACK) / (1 - FLASH_ATTACK)) ** 1.8);
  }
}
