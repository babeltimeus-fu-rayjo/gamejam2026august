import { Application, Container, Graphics } from "pixi.js";
import {
  BACKDROP_COLOR,
  LETTERBOX_COLOR,
  VIRTUAL_HEIGHT,
  VIRTUAL_WIDTH,
  type GameMode,
} from "./config";
import { SceneManager } from "./game/scenes";
import { TitleScene } from "./game/title";
import { LobbyScene } from "./game/lobby";
import { GameplayScene } from "./game/gameplay";
import { ResultsScene } from "./game/results";
import type { PlayResults } from "./game/score";

// Async IIFE: top-level await breaks production builds on older Vite.
(async () => {
  const app = new Application();
  await app.init({
    background: LETTERBOX_COLOR,
    resizeTo: window,
    antialias: true,
  });
  document.getElementById("pixi-container")!.appendChild(app.canvas);

  // Everything renders inside `root`, which is designed at 1280x720 virtual
  // coordinates and uniformly scaled to fit the window (letterboxed).
  const root = new Container();
  app.stage.addChild(root);

  const backdrop = new Graphics()
    .rect(0, 0, VIRTUAL_WIDTH, VIRTUAL_HEIGHT)
    .fill(BACKDROP_COLOR);
  root.addChild(backdrop);

  const sceneLayer = new Container();
  root.addChild(sceneLayer);

  // Poll for size changes instead of listening to window resize: the
  // ResizePlugin applies the new canvas size on the frame after the DOM
  // event, so reading app.screen from a resize listener sees stale values.
  let lastWidth = 0;
  let lastHeight = 0;
  const layout = (): void => {
    const scale = Math.min(
      app.screen.width / VIRTUAL_WIDTH,
      app.screen.height / VIRTUAL_HEIGHT,
    );
    root.scale.set(scale);
    root.position.set(
      (app.screen.width - VIRTUAL_WIDTH * scale) / 2,
      (app.screen.height - VIRTUAL_HEIGHT * scale) / 2,
    );
  };

  const scenes = new SceneManager(sceneLayer);

  // Scene flow: title -> lobby -> gameplay -> results -> back to lobby.
  // Fresh instances per switch; wiring lives here so scenes stay ignorant
  // of each other.
  // Picked on the title screen and remembered so results can return to the
  // lobby in the same mode.
  let mode: GameMode = "single";
  const toLobby = (): void => scenes.switchTo(new LobbyScene(mode, toGameplay));
  const toTitle = (): void =>
    scenes.switchTo(
      new TitleScene((picked) => {
        mode = picked;
        toLobby();
      }),
    );
  const toGameplay = (): void =>
    scenes.switchTo(new GameplayScene(toResults, toLobby));
  const toResults = (results: PlayResults): void =>
    scenes.switchTo(new ResultsScene(results, toLobby));

  app.ticker.add((ticker) => {
    if (app.screen.width !== lastWidth || app.screen.height !== lastHeight) {
      lastWidth = app.screen.width;
      lastHeight = app.screen.height;
      layout();
    }
    scenes.update(ticker);
  });

  toTitle();
})();
