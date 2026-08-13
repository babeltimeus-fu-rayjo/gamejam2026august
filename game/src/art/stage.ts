import {
  Assets,
  Container,
  Graphics,
  Matrix,
  Sprite,
  Text,
  Texture,
  Ticker,
} from "pixi.js";
import { VIRTUAL_HEIGHT, VIRTUAL_WIDTH } from "../config";
import type { Emitter } from "../core/events";
import type { Judgement } from "../game/judge";
import type { GameEvents } from "../game/score";
import type { CharacterDef, Reaction } from "./characters";
import { ReactionController } from "./reactions";

/** Illustrated live-house backdrop; generated at 2560x1440, shown at 1280x720. */
const STAGE_BG_URL = `${import.meta.env.BASE_URL}assets/stage/livehouse.png`;

/**
 * The four corners of the LED screen inside the illustration, in virtual
 * coordinates (image px / 2). Placeholder until the generated art arrives —
 * open the game with `?quad` to see the outline and tune these against it.
 */
export const SCREEN_QUAD = {
  tl: { x: 392, y: 192 },
  tr: { x: 878, y: 196 },
  br: { x: 888, y: 476 },
  bl: { x: 388, y: 476 },
} as const;

// Screen content is authored in this clean local rect, then placed onto the
// quad with an affine matrix (fit from TL/TR/BL) and clipped by a polygon
// mask of the exact four corners. Edges stay pixel-exact; the interior is
// affine-approximated, which is invisible on a near-frontal stage screen.
const SCREEN_W = 400;
const SCREEN_H = 280;

/** Whole screen layer stays translucent so notes over it remain legible. */
const SCREEN_MAX_ALPHA = 0.5;

// Equalizer bars: LED-wall life without an audio analyser. Levels mix an
// idle sine, a true beat pulse (chart bpm/offset + song time), per-lane
// judgement boosts, and a combo floor.
const BAR_COUNT = 16;
const BAR_SLOT = SCREEN_W / BAR_COUNT;
const BAR_WIDTH = BAR_SLOT - 8;
const BAR_MAX_H = SCREEN_H * 0.82;
const BAR_MIN_LEVEL = 0.06;
/** Same muted lane palette as track.ts, cycled across the bars. */
const BAR_COLORS = [0xc9708e, 0x9678c8, 0x7cb583, 0xc7a763] as const;
/** Matches the track's BURST_INTENSITY so screen and lane agree on "big". */
const HIT_INTENSITY: Readonly<Record<Judgement, number>> = {
  perfect: 1,
  great: 0.75,
  good: 0.5,
  miss: 0,
};
const HIT_DECAY_MS = 380;

// Mirrored avatar on the LED wall: appears for the showy moments (hype /
// comboBreak) and fades out when its own ReactionController returns to idle.
const MIRROR_TINT = 0x9fd8ff; // cold LED cast
const MIRROR_MAX_ALPHA = 0.85; // within the SCREEN_MAX_ALPHA'd container
const MIRROR_FADE_MS = 350;
const MIRROR_HEIGHT = SCREEN_H * 0.88;

export interface StageOptions {
  bus: Emitter<GameEvents>;
  /** Character mirrored on the screen; poses are already preloaded at boot. */
  character: CharacterDef;
}

/**
 * Full-screen art layer behind the track (PLAN.md M4): the illustrated
 * live-house background plus a live "LED screen" region driven by gameplay
 * events. Pixi-free reaction logic is reused from ReactionController, so the
 * screen's mirror avatar reacts independently of the side character.
 */
export class Stage {
  readonly view = new Container();

  private readonly controller = new ReactionController();
  private readonly unsubscribe: () => void;
  private readonly character: CharacterDef;

  private readonly bars: Sprite[] = [];
  private readonly laneEnergy = [0, 0, 0, 0];
  private mirror: Sprite | null = null;
  private mirrorTarget = 0;
  private shownVersion = 0;

  private bpm = 0;
  private offset = 0;
  private combo = 0;
  private elapsedMs = 0;
  private disposed = false;
  /** `?quad` calibration mode: outline the screen quad, force the mirror on. */
  private readonly debug = new URLSearchParams(location.search).has("quad");

  /** Warm the background image at boot; missing art is fine (fallback). */
  static preload(): Promise<unknown> {
    return Assets.load(STAGE_BG_URL).catch(() => undefined);
  }

  constructor(opts: StageOptions) {
    this.character = opts.character;
    this.unsubscribe = opts.bus.on("judgement", (e) => {
      this.controller.onJudgement(e.judgement, e.combo);
      this.combo = e.combo;
      this.laneEnergy[e.lane] = Math.max(
        this.laneEnergy[e.lane],
        HIT_INTENSITY[e.judgement],
      );
    });
    void this.build();
  }

  /** Chart timing for the on-beat pulse; called once the chart is parsed. */
  setBeat(bpm: number, offset: number): void {
    this.bpm = bpm;
    this.offset = offset;
  }

  private async build(): Promise<void> {
    const [bg] = await Promise.all([
      Assets.load<Texture>(STAGE_BG_URL).catch(() => null),
      Assets.load(Object.values(this.character.poses)),
    ]);
    // The scene (and this.view) may have been destroyed while loading.
    if (this.disposed) return;

    if (bg) {
      const sprite = new Sprite(bg);
      sprite.width = VIRTUAL_WIDTH;
      sprite.height = VIRTUAL_HEIGHT;
      this.view.addChild(sprite);
    } else {
      this.view.addChild(this.fallbackBackdrop());
    }

    this.view.addChild(this.buildScreen());
    if (this.debug) this.view.addChild(this.buildQuadDebug());
  }

  /** Stand-in until the generated illustration lands (see PLAN prompts). */
  private fallbackBackdrop(): Graphics {
    const g = new Graphics()
      // wall / floor split at a rough stage-edge line
      .rect(0, 0, VIRTUAL_WIDTH, VIRTUAL_HEIGHT * 0.78)
      .fill(0x1a1329)
      .rect(0, VIRTUAL_HEIGHT * 0.78, VIRTUAL_WIDTH, VIRTUAL_HEIGHT * 0.22)
      .fill(0x120d1f);
    // soft colored light pools in the lane palette
    const pools = [
      { x: 0.16, y: 0.3, r: 190, color: 0xc9708e },
      { x: 0.5, y: 0.75, r: 260, color: 0x9678c8 },
      { x: 0.86, y: 0.35, r: 170, color: 0xc7a763 },
      { x: 0.68, y: 0.2, r: 120, color: 0x7cb583 },
    ];
    for (const p of pools) {
      g.circle(VIRTUAL_WIDTH * p.x, VIRTUAL_HEIGHT * p.y, p.r).fill({
        color: p.color,
        alpha: 0.1,
      });
    }
    return g;
  }

  private buildScreen(): Container {
    const layer = new Container();
    layer.alpha = SCREEN_MAX_ALPHA;

    const { tl, tr, br, bl } = SCREEN_QUAD;

    // Affine fit: local (0,0)->TL, (SCREEN_W,0)->TR, (0,SCREEN_H)->BL.
    const content = new Container();
    content.setFromMatrix(
      new Matrix(
        (tr.x - tl.x) / SCREEN_W,
        (tr.y - tl.y) / SCREEN_W,
        (bl.x - tl.x) / SCREEN_H,
        (bl.y - tl.y) / SCREEN_H,
        tl.x,
        tl.y,
      ),
    );

    // Exact-edge clip; BR is only honored here, which is what the eye checks.
    const mask = new Graphics()
      .poly([tl.x, tl.y, tr.x, tr.y, br.x, br.y, bl.x, bl.y])
      .fill(0xffffff);
    content.mask = mask;

    const panel = new Graphics()
      .rect(0, 0, SCREEN_W, SCREEN_H)
      .fill({ color: 0x0a0618, alpha: 0.92 });
    content.addChild(panel);

    for (let i = 0; i < BAR_COUNT; i++) {
      const bar = new Sprite(Texture.WHITE);
      bar.tint = BAR_COLORS[i % BAR_COLORS.length];
      bar.blendMode = "add";
      bar.anchor.set(0.5, 1);
      bar.position.set((i + 0.5) * BAR_SLOT, SCREEN_H);
      bar.width = BAR_WIDTH;
      bar.height = 1;
      bar.alpha = 0.75;
      this.bars.push(bar);
      content.addChild(bar);
    }

    this.mirror = new Sprite({
      texture: this.texture(this.controller.current),
      anchor: { x: 0.5, y: 1 },
    });
    // The affine fit scales x and y independently; undo the difference so
    // the mirror keeps its proportions whatever aspect the quad has.
    const quadW = (tr.x - tl.x + (br.x - bl.x)) / 2;
    const quadH = (bl.y - tl.y + (br.y - tr.y)) / 2;
    const aspectFix = (quadW / SCREEN_W) * (SCREEN_H / quadH);
    const s = MIRROR_HEIGHT / this.character.sourceSize.h;
    this.mirror.scale.set(-s / aspectFix, s); // negative x: it's a mirror
    this.mirror.position.set(SCREEN_W / 2, SCREEN_H - 6);
    this.mirror.tint = MIRROR_TINT;
    this.mirror.alpha = 0;
    if (this.debug) this.mirrorTarget = MIRROR_MAX_ALPHA;
    content.addChild(this.mirror);
    this.shownVersion = this.controller.version;

    layer.addChild(content, mask);
    return layer;
  }

  /** `?quad` overlay: stroked screen quad + corner coords for calibration. */
  private buildQuadDebug(): Container {
    const debug = new Container();
    const { tl, tr, br, bl } = SCREEN_QUAD;
    const outline = new Graphics()
      .poly([tl.x, tl.y, tr.x, tr.y, br.x, br.y, bl.x, bl.y])
      .stroke({ width: 2, color: 0x00ff88 });
    for (const c of [tl, tr, br, bl]) {
      outline.circle(c.x, c.y, 5).fill(0x00ff88);
    }
    debug.addChild(outline);
    for (const [name, c] of Object.entries(SCREEN_QUAD)) {
      const label = new Text({
        text: `${name} ${c.x},${c.y}`,
        style: { fontFamily: "Arial", fontSize: 14, fill: 0x00ff88 },
      });
      label.position.set(c.x + 8, c.y + 4);
      debug.addChild(label);
    }
    return debug;
  }

  private texture(reaction: Reaction): Texture {
    return Assets.get<Texture>(this.character.poses[reaction]);
  }

  /**
   * @param songTime seconds into the song, or null before playback starts;
   * drives the on-beat pulse (bars thump on the chart grid, no analyser).
   */
  update(ticker: Ticker, songTime: number | null): void {
    this.controller.update(ticker.deltaMS);
    this.elapsedMs += ticker.deltaMS;

    for (let lane = 0; lane < 4; lane++) {
      this.laneEnergy[lane] = Math.max(
        0,
        this.laneEnergy[lane] - ticker.deltaMS / HIT_DECAY_MS,
      );
    }

    // On-beat pulse: sharp arrival, quick falloff across the beat interval.
    let beatPulse = 0;
    if (songTime !== null && this.bpm > 0) {
      const beats = ((songTime - this.offset) * this.bpm) / 60;
      const phase = beats - Math.floor(beats);
      beatPulse = (1 - phase) ** 2 * 0.35;
    }
    const comboFloor = Math.min(this.combo / 100, 1) * 0.2;

    for (let i = 0; i < this.bars.length; i++) {
      const idle = 0.14 + 0.08 * Math.sin(this.elapsedMs / 260 + i * 1.7);
      const hit = this.laneEnergy[i % 4] * 0.6;
      const level = Math.min(
        1,
        BAR_MIN_LEVEL + idle + beatPulse + comboFloor + hit,
      );
      this.bars[i].height = Math.max(1, level * BAR_MAX_H);
    }

    if (!this.mirror) return;

    if (this.controller.version !== this.shownVersion) {
      this.shownVersion = this.controller.version;
      const reaction = this.controller.current;
      this.mirror.texture = this.texture(reaction);
      if (reaction === "hype" || reaction === "comboBreak") {
        this.mirrorTarget = MIRROR_MAX_ALPHA;
      } else if (reaction === "idle") {
        this.mirrorTarget = 0;
      }
    }

    const step = ticker.deltaMS / MIRROR_FADE_MS;
    if (this.mirror.alpha < this.mirrorTarget) {
      this.mirror.alpha = Math.min(this.mirrorTarget, this.mirror.alpha + step);
    } else if (this.mirror.alpha > this.mirrorTarget) {
      this.mirror.alpha = Math.max(this.mirrorTarget, this.mirror.alpha - step);
    }
  }

  /** Unhook the bus; the SceneManager destroys `view` itself. */
  dispose(): void {
    this.disposed = true;
    this.unsubscribe();
  }
}
