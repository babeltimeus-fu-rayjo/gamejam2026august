import { Container, Graphics, Rectangle, Text, Ticker } from "pixi.js";
import { VIRTUAL_HEIGHT, VIRTUAL_WIDTH, type GameMode } from "../config";
import { drawAccentRing, drawPanel } from "./panel";
import type { Scene } from "./scenes";
import { VideoBackdrop } from "./video-backdrop";

// M0 placeholder: static stubs for the lobby's jobs — confirm the mode, pick a
// track, invite players. The real track list lands with charts (M3/M5);
// invite/room codes land with multiplayer (M6). START is not a row: it's the
// call to action at the bottom of the screen.
function rows(mode: GameMode): { label: string; value: string }[] {
  return [
    {
      // Kept short: this row also carries the "click to change" affordance on
      // its right edge, and the M6 caveat already sits on the INVITE row.
      label: "MODE",
      value: mode === "battle" ? "Battle — head to head" : "Single — solo run",
    },
    { label: "TRACK", value: "Demo Track — chart select lands in M3" },
    { label: "INVITE", value: "room codes land with multiplayer (M6)" },
  ];
}

/** Accents match the title screen's mode buttons, so the pick reads as carried over. */
const MODE_COLOR: Record<GameMode, number> = {
  single: 0x35f0ff,
  battle: 0xff45c8,
};

const PANEL_WIDTH = 760;
const PANEL_HEIGHT = 56;
const ROW_GAP = 18;

const START_SIZE = 66; // 3x the row text
const START_Y = VIRTUAL_HEIGHT * 0.76;
const HINT_SIZE = 22;

/** Placeholder lobby: mode/track/invite rows, any key starts the game. */
export class LobbyScene implements Scene {
  readonly view = new Container();

  private readonly backdrop = new VideoBackdrop();
  private readonly hint: Text;
  private elapsed = 0;

  constructor(
    mode: GameMode,
    private readonly onStart: () => void,
    private readonly onBack: () => void,
  ) {
    this.view.addChild(this.backdrop);

    const heading = new Text({
      text: "LOBBY",
      style: {
        fontFamily: "Arial",
        fontSize: 64,
        fontWeight: "900",
        letterSpacing: 6,
        fill: 0xffffff,
      },
    });
    heading.anchor.set(0.5);
    heading.position.set(VIRTUAL_WIDTH / 2, VIRTUAL_HEIGHT * 0.24);
    this.view.addChild(heading);

    const panelX = (VIRTUAL_WIDTH - PANEL_WIDTH) / 2;
    const firstY = VIRTUAL_HEIGHT * 0.38;

    rows(mode).forEach((r, i) => {
      const row = this.buildRow(
        r.label,
        r.value,
        r.label === "MODE" ? mode : null,
      );
      row.position.set(panelX, firstY + i * (PANEL_HEIGHT + ROW_GAP));
      this.view.addChild(row);
    });

    const start = new Text({
      text: "START",
      style: {
        fontFamily: "Arial",
        fontSize: START_SIZE,
        fontWeight: "900",
        letterSpacing: 9,
        fill: 0xffffff,
        // Outer glow: a shadow at zero distance haloes the glyphs evenly. Cheap
        // next to a real blur filter, and baked into the text texture.
        dropShadow: {
          color: 0xffffff,
          alpha: 0.5,
          blur: 12,
          distance: 0,
          angle: 0,
        },
        // Without headroom the glow is clipped at the texture's edge.
        padding: 18,
      },
    });
    start.anchor.set(0.5);
    start.position.set(VIRTUAL_WIDTH / 2, START_Y);

    this.hint = new Text({
      text: "press any key",
      style: { fontFamily: "Arial", fontSize: HINT_SIZE, fill: 0xcfc4f2 },
    });
    this.hint.anchor.set(0.5);
    this.hint.position.set(VIRTUAL_WIDTH / 2, START_Y + START_SIZE * 0.72);

    this.view.addChild(start, this.hint);
  }

  /**
   * One info row. Passing a mode makes it the clickable MODE row: it accents in
   * that mode's colour and takes you back to mode select.
   */
  private buildRow(
    label: string,
    value: string,
    mode: GameMode | null,
  ): Container {
    const row = new Container();

    const panel = new Graphics();
    drawPanel(panel, PANEL_WIDTH, PANEL_HEIGHT);

    const labelText = new Text({
      text: label,
      style: {
        fontFamily: "Arial",
        fontSize: 22,
        fontWeight: "700",
        letterSpacing: 3,
        fill: 0xcfc4f2,
      },
    });
    labelText.anchor.set(0, 0.5);
    labelText.position.set(32, PANEL_HEIGHT / 2);

    const valueText = new Text({
      text: value,
      style: {
        fontFamily: "Arial",
        fontSize: 22,
        fill: mode ? MODE_COLOR[mode] : 0x9f8fd8,
      },
    });
    valueText.anchor.set(0, 0.5);
    valueText.position.set(200, PANEL_HEIGHT / 2);

    row.addChild(panel, labelText, valueText);
    if (!mode) return row;

    // Hover ring, so the one clickable row announces itself on approach. Same
    // ring the title's selected mode button wears.
    const ring = new Graphics();
    drawAccentRing(ring, PANEL_WIDTH, PANEL_HEIGHT, MODE_COLOR[mode]);
    ring.visible = false;

    const affordance = new Text({
      text: "click to change",
      style: { fontFamily: "Arial", fontSize: 18, fill: 0x8b7bc4 },
    });
    affordance.anchor.set(1, 0.5);
    affordance.position.set(PANEL_WIDTH - 24, PANEL_HEIGHT / 2);

    row.addChild(ring, affordance);

    // Children sit above the panel, so the row hit-tests as a whole rather than
    // going dead wherever a glyph happens to be.
    row.eventMode = "static";
    row.cursor = "pointer";
    row.hitArea = new Rectangle(0, 0, PANEL_WIDTH, PANEL_HEIGHT);
    row.on("pointerover", () => {
      ring.visible = true;
      affordance.alpha = 1;
    });
    row.on("pointerout", () => {
      ring.visible = false;
      affordance.alpha = 0.7;
    });
    row.on("pointertap", () => this.onBack());
    affordance.alpha = 0.7;

    return row;
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    this.onStart();
  };

  enter(): void {
    window.addEventListener("keydown", this.onKeyDown);
    this.backdrop.play();
  }

  exit(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    this.backdrop.pause();
  }

  update(ticker: Ticker): void {
    this.elapsed += ticker.deltaMS;
    this.hint.alpha = 0.6 + 0.4 * Math.sin(this.elapsed / 350);
  }
}
