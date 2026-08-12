import { Container, Ticker } from "pixi.js";

/**
 * One screen of the game (title, gameplay, results).
 * Scenes lay themselves out in virtual 1280x720 coordinates (see config.ts);
 * boot code owns scaling. Scenes are created fresh on every switch, so they
 * never carry stale state between plays.
 */
export interface Scene {
  /** Root display object; on stage while the scene is active. */
  readonly view: Container;
  /** Called right after `view` is added to the stage. */
  enter(): void;
  /** Called right before `view` is removed from the stage. */
  exit(): void;
  /** Per-frame update while active. */
  update(ticker: Ticker): void;
}

export class SceneManager {
  private current: Scene | null = null;

  constructor(private readonly root: Container) {}

  switchTo(scene: Scene): void {
    if (this.current) {
      this.current.exit();
      this.root.removeChild(this.current.view);
      this.current.view.destroy({ children: true });
    }
    this.current = scene;
    this.root.addChild(scene.view);
    scene.enter();
    console.log(`[scenes] -> ${scene.constructor.name}`);
  }

  update(ticker: Ticker): void {
    this.current?.update(ticker);
  }
}
