import {
  Container,
  FillGradient,
  Graphics,
  GraphicsContext,
  Text,
  Ticker,
} from "pixi.js";
import { VIRTUAL_HEIGHT, VIRTUAL_WIDTH } from "../config";
import { LANE_KEY_LABELS } from "../core/input";
import { TIER_COLOR, type FeedbackTier } from "./feedback";
import { isHold, isResolved, type JudgedNote } from "./judge";

// Track geometry — a trapezoidal highway over the art layer: narrow at
// the top of the screen (the vanishing end), widening toward the player.
// Notes fall from the top into the hit line, spreading apart and growing
// as they descend. Every x/width is a linear function of y.
export const TRACK_TOP_WIDTH = 260;
export const TRACK_BOTTOM_WIDTH = 960;
export const HIT_Y = VIRTUAL_HEIGHT - 150;
/** Default travel speed, px/s at hit-line scale; difficulties override it. */
export const SCROLL_SPEED = 600;

const TRACK_CENTER_X = VIRTUAL_WIDTH / 2;

function trackWidthAt(y: number): number {
  const t = Math.max(0, Math.min(1, y / VIRTUAL_HEIGHT));
  return TRACK_TOP_WIDTH + (TRACK_BOTTOM_WIDTH - TRACK_TOP_WIDTH) * t;
}

/** Track's left edge at height y; hud.ts centers readouts in the gutter. */
export function trackLeftAt(y: number): number {
  return TRACK_CENTER_X - trackWidthAt(y) / 2;
}

/** x of the boundary between lane `edge - 1` and lane `edge` at height y. */
export function laneEdgeXAt(edge: number, y: number): number {
  return trackLeftAt(y) + (edge / 4) * trackWidthAt(y);
}

/**
 * The lane's slice of the trapezoid between two heights, optionally bled
 * `spread` px past its side edges (used by the reaction zone's outer glow).
 */
function laneQuad(
  lane: number,
  top: number,
  bottom: number,
  spread = 0,
): { x: number; y: number }[] {
  return [
    { x: laneEdgeXAt(lane, top) - spread, y: top },
    { x: laneEdgeXAt(lane + 1, top) + spread, y: top },
    { x: laneEdgeXAt(lane + 1, bottom) + spread, y: bottom },
    { x: laneEdgeXAt(lane, bottom) - spread, y: bottom },
  ];
}

function laneCenterXAt(lane: number, y: number): number {
  return trackLeftAt(y) + ((lane + 0.5) / 4) * trackWidthAt(y);
}

/**
 * Vertical "distance fog": transparent at the vanishing end, fully
 * opaque from just below the middle of the screen on down.
 */
function fadeUp(r: number, g: number, b: number, alpha: number): FillGradient {
  return new FillGradient({
    start: { x: 0, y: 0 },
    end: { x: 0, y: 1 },
    colorStops: [
      { offset: 0, color: `rgba(${r}, ${g}, ${b}, 0)` },
      { offset: 0.45, color: `rgba(${r}, ${g}, ${b}, ${alpha})` },
      { offset: 1, color: `rgba(${r}, ${g}, ${b}, ${alpha})` },
    ],
  });
}

/** Perspective size factor: 1 at the hit line, smaller upfield. */
function perspectiveAt(y: number): number {
  return trackWidthAt(y) / trackWidthAt(HIT_Y);
}

// Note geometry is authored at hit-line scale; perspectiveAt() shrinks
// sprites upfield.
export const NOTE_WIDTH = Math.round(trackWidthAt(HIT_Y) / 4) - 24;
export const NOTE_HEIGHT = 30;

// A note that passes the beat line unhit dissolves over this many px —
// sized so it reaches zero right as the miss sweep (±135ms → 81px at
// SCROLL_SPEED) releases the sprite, instead of popping out solid.
const NOTE_FADE_PX = 90;

const RECEPTOR_IDLE_ALPHA = 0.55;

// Reaction zone — the block of track under the beat line holding the D F J K
// keycaps. It is the one place the player's hands are aimed at, so it is
// where the judgement colour is shown: a lit slab plus an outer glow that
// bleeds past the zone's edges, both tinted per judgement (feedback.ts).
const PAD_HEIGHT = 104;
/** How far the outer glow bleeds past the zone, on every side. */
const PAD_GLOW_SPREAD = 30;
/** Lit level for a bare keypress — a judgement takes it all the way to 1. */
const PAD_PRESS_STRENGTH = 0.45;
const PAD_DECAY_MS = 260;
const PAD_LIGHT_ALPHA = 0.85;
const PAD_GLOW_ALPHA = 0.8;
const PAD_BASE_ALPHA = 0.16;

// Per-lane palette (D F J K) shared by notes, receptors, and key labels:
// dusty, desaturated arcane-ish tones — rose, amethyst, jade, antique
// gold — so lanes read apart without going neon on the dark backdrop.
// `label` is the same hue lifted toward white for text legibility.
const LANE_COLORS = [
  { note: 0xc9708e, label: 0xe3b3c4 }, // dusty rose
  { note: 0x9678c8, label: 0xc7b4e6 }, // muted amethyst
  { note: 0x7cb583, label: 0xb9d9bd }, // sage jade
  { note: 0xc7a763, label: 0xe3d0a4 }, // antique gold
] as const;

// One shared GraphicsContext per lane: four geometries on the GPU total,
// cheap instances in the pool. acquire() swaps a sprite's context to match
// its note's lane, so the pool stays lane-agnostic.
//
// Neon look, no filters: two oversized soft halo fills behind a bright
// core (the lane's light variant) with a white rim — baked geometry, so
// it batches like any sprite.
const NOTE_CONTEXTS = LANE_COLORS.map(({ note, label }) =>
  new GraphicsContext()
    .roundRect(
      -NOTE_WIDTH / 2 - 10,
      -NOTE_HEIGHT / 2 - 10,
      NOTE_WIDTH + 20,
      NOTE_HEIGHT + 20,
      16,
    )
    .fill({ color: note, alpha: 0.2 })
    .roundRect(
      -NOTE_WIDTH / 2 - 4,
      -NOTE_HEIGHT / 2 - 4,
      NOTE_WIDTH + 8,
      NOTE_HEIGHT + 8,
      12,
    )
    .fill({ color: note, alpha: 0.45 })
    .roundRect(-NOTE_WIDTH / 2, -NOTE_HEIGHT / 2, NOTE_WIDTH, NOTE_HEIGHT, 10)
    .fill(label)
    .stroke({ width: 2, color: 0xffffff, alpha: 0.9 }),
);

// Hold notes — a head (the same sprite a tap gets) trailing a bar the player
// has to keep the key down through. On the trapezoid the bar is a tapered
// quad following the lane's slant, re-tessellated per frame by layoutHold()
// on a body Graphics each hold owns; the cap and head are shared-context
// sprites scaled by perspective at their own heights. HOLD_WIDTH is
// authored at hit-line scale like the notes.
const HOLD_WIDTH = NOTE_WIDTH * 0.66;
const HOLD_CAP_HEIGHT = 14;
const HOLD_CAP_CONTEXTS = LANE_COLORS.map(({ note }) =>
  new GraphicsContext()
    .roundRect(
      -HOLD_WIDTH / 2,
      -HOLD_CAP_HEIGHT / 2,
      HOLD_WIDTH,
      HOLD_CAP_HEIGHT,
      6,
    )
    .fill({ color: note, alpha: 0.8 }),
);
/** Dimmed until the player is actually riding the hold. */
const HOLD_IDLE_ALPHA = 0.85;

/** A pooled hold: head + stretchable body + tail cap, moved as one. */
interface HoldSprite {
  view: Container;
  head: Graphics;
  body: Graphics;
  cap: Graphics;
}

// Hit burst — when a note is keyed in time it flashes bright at the hit
// line, blooms outward, and fades. White geometry tinted with the judgement's
// colour + additive blend reads as light, not paint. Intensity scales with
// judgement quality; a miss lights the zone red but gets no bloom.
const BURST_DURATION_MS = 280;
const BURST_MAX_SCALE = 1.55;
const BURST_INTENSITY: Readonly<Record<FeedbackTier, number>> = {
  extraordinary: 1,
  perfect: 0.9,
  great: 0.7,
  good: 0.45,
  miss: 0,
};
const BURST_CONTEXT = new GraphicsContext()
  .roundRect(-NOTE_WIDTH / 2, -NOTE_HEIGHT / 2, NOTE_WIDTH, NOTE_HEIGHT, 10)
  .fill(0xffffff);

interface Burst {
  sprite: Graphics;
  ageMs: number;
  intensity: number;
}

// Hit glow — per-lane light columns rising from the beat line: keying a note
// switches on that lane's light, strongest at the line and transparent at its
// top edge, then it fades back out. Drawn white and tinted with the
// judgement's colour, so the column says the same thing the zone does. Capped
// at half the screen height by design.
const GLOW_HEIGHT = VIRTUAL_HEIGHT * 0.5;
const GLOW_DURATION_MS = 420;
const GLOW_PEAK_ALPHA = 0.9;

/**
 * Renders the 4-lane track: lane strips, hit line, receptors, and pooled
 * note sprites positioned as a pure function of song time. Owns no game
 * state — notes' judgement fields drive sprite lifecycle.
 */
export class Track {
  readonly view = new Container();

  private readonly receptors: Graphics[] = [];
  private readonly keyLabels: Text[] = [];
  /** Reaction zone per lane: lit slab + the halo bleeding out of it. */
  private readonly padLights: Graphics[] = [];
  private readonly padGlows: Graphics[] = [];
  /** Per lane 0..1: 1 the moment a note is judged, decaying to nothing. */
  private readonly padStrengths = [0, 0, 0, 0];
  /** Colour each zone is currently showing (judgement tier, or lane idle). */
  private readonly padTints: number[] = [];
  private readonly holdsLayer = new Container();
  private readonly notesLayer = new Container();
  private readonly burstLayer = new Container();
  private readonly pool: Graphics[] = [];
  private readonly holdPool: HoldSprite[] = [];
  private readonly burstPool: Graphics[] = [];
  private readonly bursts: Burst[] = [];
  private readonly active = new Map<JudgedNote, Graphics>();
  private readonly activeHolds = new Map<JudgedNote, HoldSprite>();
  private readonly glows: Graphics[] = [];
  /** Per lane, 0..1; jumps on a hit, decays linearly, drives glow alpha. */
  private readonly glowStrengths = [0, 0, 0, 0];
  /** Index into the (sorted) note list of the next note to spawn. */
  private spawnCursor = 0;

  /** @param scrollSpeed px per second of song time (see core/difficulty.ts). */
  constructor(private readonly scrollSpeed: number = SCROLL_SPEED) {
    const g = new Graphics();
    for (let lane = 0; lane < 4; lane++) {
      // rgba of the two alternating strip colors 0x181226 / 0x1d1630,
      // fading into the dark at the vanishing end.
      const strip =
        lane % 2 === 0 ? fadeUp(24, 18, 38, 0.6) : fadeUp(29, 22, 48, 0.6);
      g.poly([
        { x: laneEdgeXAt(lane, 0), y: 0 },
        { x: laneEdgeXAt(lane + 1, 0), y: 0 },
        { x: laneEdgeXAt(lane + 1, VIRTUAL_HEIGHT), y: VIRTUAL_HEIGHT },
        { x: laneEdgeXAt(lane, VIRTUAL_HEIGHT), y: VIRTUAL_HEIGHT },
      ]).fill(strip);
    }
    // Outer edges + the three lane dividers, fading with the strips
    // (rgba of 0x3a2f5c).
    for (let edge = 0; edge <= 4; edge++) {
      g.moveTo(laneEdgeXAt(edge, 0), 0).lineTo(
        laneEdgeXAt(edge, VIRTUAL_HEIGHT),
        VIRTUAL_HEIGHT,
      );
    }
    g.stroke({ width: 2, fill: fadeUp(58, 47, 92, 1) });
    g.rect(trackLeftAt(HIT_Y), HIT_Y, trackWidthAt(HIT_Y), 4).fill(0xbfb3e0);

    // White, fading to nothing at the top; tinted per judgement and its
    // alpha animated per hit.
    const glowGradient = new FillGradient({
      start: { x: 0, y: 1 },
      end: { x: 0, y: 0 },
      colorStops: [
        { offset: 0, color: "rgba(255, 255, 255, 0.5)" },
        { offset: 1, color: "rgba(255, 255, 255, 0)" },
      ],
    });
    // One light column per lane, each following its lane's slanted edges
    // up from the hit line.
    const glowTop = HIT_Y - GLOW_HEIGHT;
    for (let lane = 0; lane < 4; lane++) {
      const glow = new Graphics()
        .poly([
          { x: laneEdgeXAt(lane, glowTop), y: glowTop },
          { x: laneEdgeXAt(lane + 1, glowTop), y: glowTop },
          { x: laneEdgeXAt(lane + 1, HIT_Y), y: HIT_Y },
          { x: laneEdgeXAt(lane, HIT_Y), y: HIT_Y },
        ])
        .fill(glowGradient);
      glow.blendMode = "add";
      glow.alpha = 0;
      this.glows.push(glow);
    }

    // Glows sit behind notes so rising light never obscures gameplay; hold
    // bars sit behind taps so a chord over a sustain still reads.
    this.view.addChild(
      g,
      ...this.glows,
      this.holdsLayer,
      this.notesLayer,
      this.burstLayer,
    );

    this.buildReactionZones();
  }

  /**
   * The D F J K reaction zone: one lit block of track per lane under the beat
   * line, holding that lane's keycap. Three layers, all drawn white so a
   * single `tint` per lane recolours the whole zone to the judgement's colour:
   *
   * - **base**, always visible, dim: draws the region so the player can see
   *   where the zone is before touching anything;
   * - **light**, brightest at the beat line and fading down the slab;
   * - **glow**, a bigger quad bled past every edge and additively blended —
   *   the outer glow, which is what makes the zone read as lit from within
   *   rather than painted.
   */
  private buildReactionZones(): void {
    const padBottom = HIT_Y + PAD_HEIGHT;
    const glowTop = HIT_Y - PAD_GLOW_SPREAD;
    const glowBottom = padBottom + PAD_GLOW_SPREAD;
    // Where the beat line falls inside the glow quad: the halo peaks on the
    // line itself and falls away above and below it.
    const linePoint = PAD_GLOW_SPREAD / (glowBottom - glowTop);

    for (let lane = 0; lane < 4; lane++) {
      this.padTints.push(LANE_COLORS[lane].note);

      const glow = new Graphics()
        .poly(laneQuad(lane, glowTop, glowBottom, PAD_GLOW_SPREAD))
        .fill(
          new FillGradient({
            start: { x: 0, y: 0 },
            end: { x: 0, y: 1 },
            colorStops: [
              { offset: 0, color: "rgba(255, 255, 255, 0)" },
              { offset: linePoint, color: "rgba(255, 255, 255, 0.55)" },
              { offset: 0.6, color: "rgba(255, 255, 255, 0.2)" },
              { offset: 1, color: "rgba(255, 255, 255, 0)" },
            ],
          }),
        );
      glow.blendMode = "add";
      glow.alpha = 0;
      this.padGlows.push(glow);

      const base = new Graphics()
        .poly(laneQuad(lane, HIT_Y, padBottom))
        .fill({ color: LANE_COLORS[lane].note, alpha: PAD_BASE_ALPHA })
        .poly(laneQuad(lane, HIT_Y, padBottom))
        .stroke({ width: 2, color: LANE_COLORS[lane].note, alpha: 0.45 });

      const light = new Graphics().poly(laneQuad(lane, HIT_Y, padBottom)).fill(
        new FillGradient({
          start: { x: 0, y: 0 },
          end: { x: 0, y: 1 },
          colorStops: [
            { offset: 0, color: "rgba(255, 255, 255, 0.75)" },
            { offset: 1, color: "rgba(255, 255, 255, 0.05)" },
          ],
        }),
      );
      light.blendMode = "add";
      light.alpha = 0;
      this.padLights.push(light);

      const cx = laneCenterXAt(lane, HIT_Y + 50);
      const box = new Graphics()
        .roundRect(cx - 26, HIT_Y + 24, 52, 52, 8)
        .stroke({ width: 3, color: 0xffffff });
      box.tint = LANE_COLORS[lane].note;
      box.alpha = RECEPTOR_IDLE_ALPHA;
      this.receptors.push(box);

      // White fill + tint, like everything else in the zone, so the keycap
      // takes the judgement colour without re-rendering its texture.
      const label = new Text({
        text: LANE_KEY_LABELS[lane],
        style: {
          fontFamily: "Arial",
          fontSize: 28,
          fontWeight: "700",
          fill: 0xffffff,
        },
      });
      label.anchor.set(0.5);
      label.position.set(cx, HIT_Y + 50);
      label.tint = LANE_COLORS[lane].label;
      this.keyLabels.push(label);

      this.view.addChild(glow, base, light, box, label);
    }
  }

  /** Light a lane's zone at press level, in its own colour: no judgement yet. */
  flash(lane: number): void {
    if (this.padStrengths[lane] <= PAD_PRESS_STRENGTH) {
      this.padStrengths[lane] = PAD_PRESS_STRENGTH;
      this.padTints[lane] = LANE_COLORS[lane].label;
      this.applyPad(lane);
    }
  }

  /**
   * Show a judgement in a lane: the reaction zone, its glow, the keycap, the
   * rising light column and the bloom all take the tier's colour at once.
   * A miss lights the zone red but gets no bloom.
   */
  judged(lane: number, tier: FeedbackTier): void {
    const color = TIER_COLOR[tier];
    this.padTints[lane] = color;
    this.padStrengths[lane] = 1;
    this.applyPad(lane);
    this.glows[lane].tint = color;

    const intensity = BURST_INTENSITY[tier];
    if (intensity <= 0) return;
    let sprite = this.burstPool.pop();
    if (!sprite) {
      sprite = new Graphics(BURST_CONTEXT);
      sprite.blendMode = "add";
      this.burstLayer.addChild(sprite);
    }
    sprite.tint = color;
    sprite.position.set(laneCenterXAt(lane, HIT_Y), HIT_Y);
    sprite.scale.set(1);
    sprite.alpha = intensity;
    sprite.visible = true;
    this.bursts.push({ sprite, ageMs: 0, intensity });

    this.glowStrengths[lane] = Math.max(this.glowStrengths[lane], intensity);
    this.glows[lane].alpha = GLOW_PEAK_ALPHA * this.glowStrengths[lane] ** 2;
  }

  /** Push a lane's current strength + colour onto its four zone layers. */
  private applyPad(lane: number): void {
    const s = this.padStrengths[lane];
    const color = s > 0 ? this.padTints[lane] : LANE_COLORS[lane].note;
    this.padLights[lane].tint = color;
    this.padGlows[lane].tint = color;
    this.receptors[lane].tint = color;
    this.keyLabels[lane].tint = s > 0 ? color : LANE_COLORS[lane].label;
    this.padLights[lane].alpha = PAD_LIGHT_ALPHA * s;
    // Squared: the halo arrives hard on the hit and thins out fast, so a
    // steady stream of notes doesn't leave the zone permanently blown out.
    this.padGlows[lane].alpha = PAD_GLOW_ALPHA * s ** 2;
    this.receptors[lane].alpha =
      RECEPTOR_IDLE_ALPHA + (1 - RECEPTOR_IDLE_ALPHA) * s;
  }

  update(ticker: Ticker): void {
    for (let lane = 0; lane < 4; lane++) {
      if (this.padStrengths[lane] <= 0) continue;
      this.padStrengths[lane] = Math.max(
        0,
        this.padStrengths[lane] - ticker.deltaMS / PAD_DECAY_MS,
      );
      this.applyPad(lane);
    }

    for (let lane = 0; lane < 4; lane++) {
      if (this.glowStrengths[lane] <= 0) continue;
      this.glowStrengths[lane] = Math.max(
        0,
        this.glowStrengths[lane] - ticker.deltaMS / GLOW_DURATION_MS,
      );
      // Squared: bright arrival, gentle tail.
      this.glows[lane].alpha = GLOW_PEAK_ALPHA * this.glowStrengths[lane] ** 2;
    }

    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const burst = this.bursts[i];
      burst.ageMs += ticker.deltaMS;
      const p = burst.ageMs / BURST_DURATION_MS;
      if (p >= 1) {
        burst.sprite.visible = false;
        this.burstPool.push(burst.sprite);
        this.bursts.splice(i, 1);
        continue;
      }
      const fade = (1 - p) ** 2; // starts at full flash, eases out
      burst.sprite.alpha = burst.intensity * fade;
      burst.sprite.scale.set(
        1 + (BURST_MAX_SCALE - 1) * (1 - fade) * burst.intensity,
      );
    }
  }

  /**
   * Spawn sprites for notes entering the look-ahead window, position open
   * notes, and pool sprites of judged notes. `notes` must be sorted by t
   * (parseChart guarantees it).
   */
  sync(notes: readonly JudgedNote[], songTime: number): void {
    const lookAhead = (HIT_Y + NOTE_HEIGHT) / this.scrollSpeed;
    while (
      this.spawnCursor < notes.length &&
      notes[this.spawnCursor].t <= songTime + lookAhead
    ) {
      const note = notes[this.spawnCursor];
      this.spawnCursor += 1;
      if (isResolved(note)) continue;
      if (isHold(note)) this.acquireHold(note);
      else this.acquire(note);
    }

    for (const [note, sprite] of this.active) {
      if (note.judgement !== null) {
        this.release(note);
        continue;
      }
      // Perspective: x and size follow the lane as it widens downfield.
      const y = HIT_Y - (note.t - songTime) * this.scrollSpeed;
      sprite.y = y;
      sprite.x = laneCenterXAt(note.lane, y);
      sprite.scale.set(perspectiveAt(y));
      // Above the line this clamps to 1; below it, dissolve.
      sprite.alpha = Math.min(1, Math.max(0, 1 - (y - HIT_Y) / NOTE_FADE_PX));
    }

    for (const [note, hold] of this.activeHolds) {
      if (isResolved(note)) {
        this.releaseHold(note);
        continue;
      }
      // While the key is down the bar is being consumed: pin its bottom to
      // the hit line and let the tail cap fall toward it. Before that it
      // scrolls as one piece, head first.
      const headY = HIT_Y - (note.t - songTime) * this.scrollSpeed;
      const tailY = HIT_Y - (note.t + note.d - songTime) * this.scrollSpeed;
      const bottom = note.holding ? HIT_Y : headY;
      this.layoutHold(note.lane, hold, bottom, tailY);
      hold.head.visible = note.judgement === null;
      // Un-hit holds dissolve past the line just like taps.
      const fade = Math.min(
        1,
        Math.max(0, 1 - (bottom - HIT_Y) / NOTE_FADE_PX),
      );
      hold.view.alpha = (note.holding ? 1 : HOLD_IDLE_ALPHA) * fade;
      // Keep the receptor lit for the whole sustain, not just its head.
      if (note.holding) this.flash(note.lane);
    }
  }

  /**
   * Lay out a hold on the trapezoid. A scale-stretched bar can't follow
   * the slanted lane, so the body is re-tessellated as a tapered quad
   * between the head's and tail's local lane widths; cap and head take
   * the perspective scale at their own heights. Active holds are few,
   * so the per-frame poly rebuild stays cheap.
   *
   * Both ends of that quad have to sit inside the frame. The lane geometry
   * is only defined between the vanishing end and the bottom of the screen —
   * `trackWidthAt` clamps outside it — so a bar long enough to run off the
   * top would take y=0's x for a vertex placed thousands of px higher, and
   * the visible stretch would lean out of its lane. Clamping the *drawn*
   * span keeps the quad exact instead: the lane's edges are linear in y, so
   * a bar between any two on-screen heights follows them precisely, and a
   * long hold slides down out of the vanishing point still glued to its lane.
   */
  private layoutHold(
    lane: number,
    hold: HoldSprite,
    bottom: number,
    tailY: number,
  ): void {
    const clamp = (y: number): number =>
      Math.max(0, Math.min(VIRTUAL_HEIGHT, y));
    const tail = Math.min(bottom, tailY);
    const top = clamp(tail);
    const foot = clamp(bottom);
    const bw = (HOLD_WIDTH / 2) * perspectiveAt(foot);
    const tw = (HOLD_WIDTH / 2) * perspectiveAt(top);
    const bx = laneCenterXAt(lane, foot);
    const tx = laneCenterXAt(lane, top);
    hold.body.clear();
    // A hold that hasn't reached the frame yet clamps both ends to the same
    // height. Drawing that flat quad anyway hands the triangulator a shape
    // with no area, which yields no triangles for indices the batcher has
    // already counted — WebGL then rejects the draw ("insufficient buffer
    // size") for the whole batch. An empty body is the correct picture here
    // in any case: there is nothing on screen to draw yet.
    if (foot - top >= 1) {
      hold.body
        .poly([
          { x: bx - bw, y: foot },
          { x: bx + bw, y: foot },
          { x: tx + tw, y: top },
          { x: tx - tw, y: top },
        ])
        .fill({ color: LANE_COLORS[lane].note, alpha: 0.5 });
    }
    // The cap marks where the hold actually ends; while that is still
    // upfield of the frame, drawing it at the clamped top would plant a
    // false end on the horizon.
    hold.cap.visible = tail >= 0;
    hold.cap.position.set(tx, top);
    hold.cap.scale.set(perspectiveAt(top));
    hold.head.position.set(bx, foot);
    hold.head.scale.set(perspectiveAt(foot));
  }

  private acquire(note: JudgedNote): void {
    let sprite = this.pool.pop();
    if (!sprite) {
      sprite = new Graphics(NOTE_CONTEXTS[note.lane]);
      this.notesLayer.addChild(sprite);
    }
    sprite.context = NOTE_CONTEXTS[note.lane];
    sprite.visible = true;
    sprite.x = laneCenterXAt(note.lane, -NOTE_HEIGHT);
    sprite.y = -NOTE_HEIGHT;
    sprite.scale.set(perspectiveAt(-NOTE_HEIGHT));
    this.active.set(note, sprite);
  }

  private release(note: JudgedNote): void {
    const sprite = this.active.get(note);
    if (!sprite) return;
    sprite.visible = false;
    this.pool.push(sprite);
    this.active.delete(note);
  }

  private acquireHold(note: JudgedNote): void {
    let hold = this.holdPool.pop();
    if (!hold) {
      const view = new Container();
      // The body owns its Graphics: layoutHold() clear()s and redraws it
      // every frame, which must never mutate a shared context.
      const body = new Graphics();
      const cap = new Graphics(HOLD_CAP_CONTEXTS[note.lane]);
      const head = new Graphics(NOTE_CONTEXTS[note.lane]);
      view.addChild(body, cap, head);
      this.holdsLayer.addChild(view);
      hold = { view, head, body, cap };
    }
    hold.cap.context = HOLD_CAP_CONTEXTS[note.lane];
    hold.head.context = NOTE_CONTEXTS[note.lane];
    hold.head.visible = true;
    hold.view.alpha = HOLD_IDLE_ALPHA;
    hold.view.visible = true;
    // Children are laid out in absolute coordinates by layoutHold().
    hold.view.position.set(0, 0);
    this.activeHolds.set(note, hold);
  }

  private releaseHold(note: JudgedNote): void {
    const hold = this.activeHolds.get(note);
    if (!hold) return;
    hold.view.visible = false;
    this.holdPool.push(hold);
    this.activeHolds.delete(note);
  }
}
