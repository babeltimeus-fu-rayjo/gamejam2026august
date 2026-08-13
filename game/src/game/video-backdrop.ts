import {
  Assets,
  Container,
  Graphics,
  Sprite,
  type DestroyOptions,
  type Texture,
  type VideoSource,
} from "pixi.js";
import { VIRTUAL_HEIGHT, VIRTUAL_WIDTH } from "../config";

const ALIAS = "lobby-bg";
const URL = `${import.meta.env.BASE_URL}video/lobby-bg.mp4`;

/**
 * Muted so the clip's own audio track never plays — the menus' music is the
 * BGM's job — and because browsers only autoplay muted video. `updateFPS`
 * matches the source's 30fps: re-uploading the frame more often than the video
 * produces one is wasted bandwidth on a 1920x1080 texture.
 */
const VIDEO_OPTIONS = {
  autoPlay: true,
  loop: true,
  muted: true,
  playsinline: true,
  updateFPS: 30,
};

/**
 * Register the clip and start pulling it down. Called at boot so the ~9MB file
 * is warm by the time anyone reaches a menu; without it the first visit shows a
 * flat fill for as long as the download takes.
 */
export function preloadVideoBackdrop(): void {
  Assets.add({ alias: ALIAS, src: URL, data: VIDEO_OPTIONS });
  void Assets.backgroundLoad(ALIAS).catch((err) =>
    console.warn("[video-backdrop] preload failed", err),
  );
}

/**
 * Fullscreen looping video background.
 *
 * Scaled to cover and centred, with a mask over the virtual frame. The clip is
 * 16:9 like the stage, so today there is nothing to clip; the cover-and-mask
 * pair is what keeps a differently-shaped replacement from letterboxing or
 * painting out into the bars beside the frame.
 *
 * The texture lives in the Assets cache and is deliberately *not* destroyed
 * with the scene: it's shared with every later lobby visit. Playback is paused
 * on the way out instead, so nothing decodes while the scene is off screen.
 */
export class VideoBackdrop extends Container {
  private source: VideoSource | null = null;
  private wantPlaying = true;

  constructor() {
    super();

    // Under the video: covers the frames before the first decode, and reads as
    // deliberate rather than as a hole if the file ever fails to load.
    this.addChild(
      new Graphics().rect(0, 0, VIRTUAL_WIDTH, VIRTUAL_HEIGHT).fill(0x05030d),
    );

    // The clip peaks bright, so the type needs something to sit on. Same scrim
    // the tunnel backdrop uses, for a consistent menu look.
    this.addChild(
      new Graphics()
        .rect(0, 0, VIRTUAL_WIDTH, VIRTUAL_HEIGHT)
        .fill({ color: 0x05030d, alpha: 0.32 }),
    );

    const clip = new Graphics()
      .rect(0, 0, VIRTUAL_WIDTH, VIRTUAL_HEIGHT)
      .fill(0xffffff);
    this.addChild(clip);
    this.mask = clip;

    void this.load();
  }

  private async load(): Promise<void> {
    let texture: Texture;
    try {
      texture = await Assets.load<Texture>(ALIAS);
    } catch (err) {
      console.warn("[video-backdrop] video unavailable", err);
      return;
    }
    // The scene can be torn down while the download is still in flight.
    if (this.destroyed) return;

    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5);
    sprite.position.set(VIRTUAL_WIDTH / 2, VIRTUAL_HEIGHT / 2);
    // Cover: fill both axes and crop the overhang, never letterbox.
    const scale = Math.max(
      VIRTUAL_WIDTH / texture.width,
      VIRTUAL_HEIGHT / texture.height,
    );
    sprite.scale.set(scale);

    // Index 1: above the base fill, below the scrim.
    this.addChildAt(sprite, 1);

    this.source = texture.source as VideoSource;
    if (this.wantPlaying) this.play();
    else this.pause();
  }

  /** Resume the loop. Safe before the video has finished loading. */
  play(): void {
    this.wantPlaying = true;
    void this.source?.resource?.play().catch(() => {
      // Autoplay can still be refused; the clip picks up on the next attempt.
    });
  }

  /** Stop decoding while the backdrop is off screen. */
  pause(): void {
    this.wantPlaying = false;
    this.source?.resource?.pause();
  }

  override destroy(options?: DestroyOptions): void {
    // The element outlives us in the Assets cache, so leaving it playing would
    // decode 2516x1080 frames for a scene that is no longer on screen.
    this.pause();
    super.destroy(options);
  }
}
