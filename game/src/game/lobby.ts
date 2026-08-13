import { Container, Graphics, Text, Ticker } from "pixi.js";
import { VIRTUAL_HEIGHT, VIRTUAL_WIDTH } from "../config";
import type { Scene } from "./scenes";

// M0 placeholder: static stubs for the lobby's three jobs — pick a track,
// invite players, start. The real track list lands with charts (M3/M5);
// invite/room codes land with multiplayer (M6).
const ROWS = [
  { label: "TRACK", value: "Demo Track — chart select lands in M3" },
  { label: "INVITE", value: "room codes land with multiplayer (M6)" },
  { label: "START", value: "press any key" },
] as const;

const PANEL_WIDTH = 760;
const PANEL_HEIGHT = 56;
const ROW_GAP = 18;

/** Placeholder lobby: track select + invite stubs, any key starts the game. */
export class LobbyScene implements Scene {
  readonly view = new Container();

  private readonly startRow: Text;
  private elapsed = 0;

  constructor(private readonly onStart: () => void) {
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
    const firstY = VIRTUAL_HEIGHT * 0.42;
    let start: Text | null = null;

    ROWS.forEach((row, i) => {
      const y = firstY + i * (PANEL_HEIGHT + ROW_GAP);

      const panel = new Graphics()
        .roundRect(panelX, y, PANEL_WIDTH, PANEL_HEIGHT, 10)
        .fill(0x1d1630);

      const label = new Text({
        text: row.label,
        style: {
          fontFamily: "Arial",
          fontSize: 22,
          fontWeight: "700",
          letterSpacing: 3,
          fill: 0xcfc4f2,
        },
      });
      label.anchor.set(0, 0.5);
      label.position.set(panelX + 32, y + PANEL_HEIGHT / 2);

      const value = new Text({
        text: row.value,
        style: { fontFamily: "Arial", fontSize: 22, fill: 0x9f8fd8 },
      });
      value.anchor.set(0, 0.5);
      value.position.set(panelX + 200, y + PANEL_HEIGHT / 2);

      this.view.addChild(panel, label, value);
      if (row.label === "START") start = value;
    });

    // `start` is always assigned above; the fallback keeps TS happy.
    this.startRow = start ?? new Text();
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    // Bare modifiers don't count as "any key" — Shift alone must not
    // launch the game. Nor do events with no key name (some browsers
    // and input tools emit key "" or "Unidentified").
    if (
      ["Shift", "Control", "Alt", "Meta", "Unidentified", ""].includes(e.key)
    ) {
      return;
    }
    this.onStart();
  };

  enter(): void {
    window.addEventListener("keydown", this.onKeyDown);
  }

  exit(): void {
    window.removeEventListener("keydown", this.onKeyDown);
  }

  update(ticker: Ticker): void {
    this.elapsed += ticker.deltaMS;
    this.startRow.alpha = 0.6 + 0.4 * Math.sin(this.elapsed / 350);
  }
}
