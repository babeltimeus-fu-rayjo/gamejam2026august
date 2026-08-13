import { Container, Graphics, Rectangle, Text } from "pixi.js";
import { VIRTUAL_HEIGHT, VIRTUAL_WIDTH } from "../config";
import { CODE_ALPHABET, ROOM_CODE_LENGTH } from "../net/protocol";
import { drawPanel } from "./panel";
import { makePill, type Pill } from "./pill-button";

// 4 rows x 8 keys covers the whole 32-char room-code alphabet. An on-screen
// pad beats a hidden DOM <input>: the native soft keyboard resizes the
// visual viewport (rescaling the letterbox mid-entry) and iOS only focuses
// inputs inside the original tap gesture. Hunting 4 characters on a grid
// costs seconds; fighting the soft keyboard costs the feature.
const KEYS_PER_ROW = 8;
const KEY_WIDTH = 56;
const KEY_HEIGHT = 44;
const KEY_GAP = 8;
const GRID_WIDTH = KEYS_PER_ROW * KEY_WIDTH + (KEYS_PER_ROW - 1) * KEY_GAP;
const PAD_MARGIN = 28;
const PANEL_WIDTH = GRID_WIDTH + PAD_MARGIN * 2;
const TITLE_Y = 34;
const CODE_Y = 78;
const GRID_Y = 116;
const ACTION_GAP = 14;
const ACTION_HEIGHT = 44;

export interface CodePadHandlers {
  onChar: (c: string) => void;
  onBackspace: () => void;
  onJoin: () => void;
  onCancel: () => void;
}

/**
 * Join-code entry as a modal: a full-screen backdrop swallows stray taps
 * (no START launch mid-entry), a panel shows the code so far, and the code
 * alphabet is a tappable key grid with BACK / CANCEL / JOIN. The keyboard
 * path stays live in parallel — both mutate the lobby's one code buffer.
 */
export class CodePad {
  readonly view = new Container();

  private readonly codeText: Text;
  private readonly joinPill: Pill;

  constructor(handlers: CodePadHandlers) {
    // Modal backdrop: dims the lobby and eats every tap outside the panel.
    const backdrop = new Graphics()
      .rect(0, 0, VIRTUAL_WIDTH, VIRTUAL_HEIGHT)
      .fill({ color: 0x0e0a1a, alpha: 0.72 });
    backdrop.eventMode = "static";

    const panel = new Container();
    const gridRows = CODE_ALPHABET.length / KEYS_PER_ROW;
    const actionsY =
      GRID_Y + gridRows * (KEY_HEIGHT + KEY_GAP) - KEY_GAP + ACTION_GAP;
    const panelHeight = actionsY + ACTION_HEIGHT + PAD_MARGIN;
    const bg = new Graphics();
    drawPanel(bg, PANEL_WIDTH, panelHeight);
    panel.addChild(bg);

    const title = new Text({
      text: "ENTER ROOM CODE",
      style: {
        fontFamily: "Arial",
        fontSize: 22,
        fontWeight: "700",
        letterSpacing: 3,
        fill: 0xcfc4f2,
      },
    });
    title.anchor.set(0.5);
    title.position.set(PANEL_WIDTH / 2, TITLE_Y);
    panel.addChild(title);

    this.codeText = new Text({
      text: "",
      style: {
        fontFamily: "Arial",
        fontSize: 34,
        fontWeight: "900",
        letterSpacing: 12,
        fill: 0x35f0ff,
      },
    });
    this.codeText.anchor.set(0.5);
    this.codeText.position.set(PANEL_WIDTH / 2, CODE_Y);
    panel.addChild(this.codeText);
    this.setCode("");

    CODE_ALPHABET.split("").forEach((char, i) => {
      const pill = makePill({
        label: char,
        minWidth: KEY_WIDTH,
        height: KEY_HEIGHT,
        onTap: () => handlers.onChar(char),
      });
      pill.view.position.set(
        PAD_MARGIN + (i % KEYS_PER_ROW) * (KEY_WIDTH + KEY_GAP),
        GRID_Y + Math.floor(i / KEYS_PER_ROW) * (KEY_HEIGHT + KEY_GAP),
      );
      panel.addChild(pill.view);
    });

    const back = makePill({
      label: "⌫ BACK",
      minWidth: 120,
      height: ACTION_HEIGHT,
      onTap: handlers.onBackspace,
    });
    back.view.position.set(PAD_MARGIN, actionsY);
    const cancel = makePill({
      label: "CANCEL",
      minWidth: 120,
      height: ACTION_HEIGHT,
      onTap: handlers.onCancel,
    });
    cancel.view.position.set(PAD_MARGIN + 136, actionsY);
    this.joinPill = makePill({
      label: "JOIN",
      minWidth: GRID_WIDTH - 272,
      height: ACTION_HEIGHT,
      color: 0x35f0ff,
      onTap: handlers.onJoin,
    });
    this.joinPill.view.position.set(PAD_MARGIN + 272, actionsY);
    panel.addChild(back.view, cancel.view, this.joinPill.view);

    // The panel itself must also block taps from falling through to rows.
    panel.eventMode = "static";
    panel.hitArea = new Rectangle(0, 0, PANEL_WIDTH, panelHeight);
    panel.position.set(
      (VIRTUAL_WIDTH - PANEL_WIDTH) / 2,
      (VIRTUAL_HEIGHT - panelHeight) / 2,
    );

    this.view.addChild(backdrop, panel);
  }

  /** Mirror the lobby's code buffer, blanks padded with underscores. */
  setCode(code: string): void {
    const shown = code.padEnd(ROOM_CODE_LENGTH, "_").split("").join(" ");
    if (this.codeText.text !== shown) this.codeText.text = shown;
  }

  /** Grey JOIN out until the code has all its characters. */
  setJoinEnabled(enabled: boolean): void {
    this.joinPill.setEnabled(enabled);
  }
}
