import { BitmapText, Container, Graphics, Text, Ticker } from "pixi.js";
import { VIRTUAL_WIDTH } from "../config";
import type { Judgement } from "../game/judge";
import type { NetRoom, RemotePlayer } from "../net/room";

/**
 * Opponent readout for mirror play (PLAN.md §8): a compact panel pinned to
 * the top-right, deliberately smaller and dimmer than the player's own HUD.
 *
 * It is pure display of whatever last arrived over the wire — a dropped or
 * late message only stales this panel, never local gameplay. It hides itself
 * entirely when there's no room or no peer, so single play is unaffected.
 */

const PANEL_WIDTH = 300;
const PANEL_HEIGHT = 92;
const MARGIN = 24;
const PANEL_X = VIRTUAL_WIDTH - MARGIN - PANEL_WIDTH;
/**
 * Below the life gauge, which owns the top-right corner (x 1016–1256, label
 * from y~22, bar through y=58). The opponent readout is secondary to your own
 * survival, so it yields the corner rather than competing for it.
 */
const PANEL_Y = 72;
const PAD = 14;

/** Roughly two-thirds the player HUD's type sizes — present, not competing. */
const NAME_SIZE = 14;
const SCORE_SIZE = 20;
const COMBO_SIZE = 17;

const JUDGEMENT_TINT: Readonly<Record<Judgement, number>> = {
  perfect: 0xffd75c,
  great: 0x5cd7ff,
  good: 0x9f8fd8,
  miss: 0xff5c5c,
};

const FLASH_HOLD_MS = 200;
const FLASH_FADE_MS = 400;

export class GhostHud {
  readonly view = new Container();

  private readonly nameText: Text;
  private readonly scoreText: BitmapText;
  private readonly comboText: BitmapText;
  private readonly flash: BitmapText;
  private readonly unsubscribes: (() => void)[] = [];

  private flashAgeMs = Infinity;
  private departed = false;

  constructor(private readonly room: NetRoom | null) {
    const panel = new Graphics()
      .roundRect(PANEL_X, PANEL_Y, PANEL_WIDTH, PANEL_HEIGHT, 10)
      .fill({ color: 0x1d1630, alpha: 0.72 })
      .stroke({ width: 2, color: 0x3a2f5c });

    this.nameText = new Text({
      text: "OPPONENT",
      style: {
        fontFamily: "Arial",
        fontSize: NAME_SIZE,
        fontWeight: "700",
        letterSpacing: 2,
        fill: 0x8f7bd8,
      },
    });
    this.nameText.position.set(PANEL_X + PAD, PANEL_Y + PAD - 2);

    this.scoreText = new BitmapText({
      text: "SCORE 0",
      style: { fontFamily: "Arial", fontSize: SCORE_SIZE, fill: 0xcfc4f2 },
    });
    this.scoreText.position.set(PANEL_X + PAD, PANEL_Y + PAD + 18);

    this.comboText = new BitmapText({
      text: "",
      style: {
        fontFamily: "Arial",
        fontSize: COMBO_SIZE,
        fontWeight: "900",
        fill: 0xffffff,
      },
    });
    this.comboText.position.set(PANEL_X + PAD, PANEL_Y + PAD + 44);

    // Right-aligned so a long judgement name grows away from the combo.
    this.flash = new BitmapText({
      text: "",
      style: {
        fontFamily: "Arial",
        fontSize: COMBO_SIZE,
        fontWeight: "900",
        fill: 0xffffff,
      },
    });
    this.flash.anchor.set(1, 0);
    this.flash.position.set(PANEL_X + PANEL_WIDTH - PAD, PANEL_Y + PAD + 44);
    this.flash.alpha = 0;

    this.view.addChild(
      panel,
      this.nameText,
      this.scoreText,
      this.comboText,
      this.flash,
    );
    this.view.visible = false;

    if (room) this.subscribe(room);
  }

  private subscribe(room: NetRoom): void {
    this.applyPeers(room.peers);
    this.unsubscribes.push(
      room.bus.on("peers", (peers) => {
        this.applyPeers(peers);
      }),
      room.bus.on("hit", ({ msg }) => {
        this.setScore(msg.score, msg.combo);
        this.flash.text = msg.judgement.toUpperCase();
        this.flash.tint = JUDGEMENT_TINT[msg.judgement];
        this.flashAgeMs = 0;
      }),
      room.bus.on("state", ({ msg }) => {
        // Catch-up path: a dropped `hit` can't leave the readout stale.
        this.setScore(msg.score, msg.combo);
      }),
      room.bus.on("finish", ({ msg }) => {
        this.setScore(msg.score, 0);
        this.nameText.text = `${this.peerName()} · FINISHED`;
      }),
    );
  }

  private peerName(): string {
    const peer = this.room?.peers[0];
    return (peer?.name ?? "OPPONENT").toUpperCase();
  }

  /**
   * Mirror play is 1v1 for now, so the first peer is the opponent. A peer
   * leaving mid-song freezes the last numbers rather than blanking them —
   * the score they left on is the interesting part.
   */
  private applyPeers(peers: readonly RemotePlayer[]): void {
    const peer = peers[0];
    if (!peer) {
      if (this.view.visible) {
        this.departed = true;
        this.nameText.text = "OPPONENT · LEFT";
        this.view.alpha = 0.45;
      }
      return;
    }
    this.departed = false;
    this.view.visible = true;
    this.view.alpha = 1;
    this.nameText.text = peer.name.toUpperCase();
    this.setScore(peer.score, peer.combo);
  }

  private setScore(score: number, combo: number): void {
    const scoreLine = `SCORE ${score}`;
    if (this.scoreText.text !== scoreLine) this.scoreText.text = scoreLine;
    const comboLine = combo >= 2 ? `${combo} COMBO` : "";
    if (this.comboText.text !== comboLine) this.comboText.text = comboLine;
  }

  update(ticker: Ticker): void {
    if (!this.view.visible || this.departed) return;
    this.flashAgeMs += ticker.deltaMS;
    if (this.flashAgeMs <= FLASH_HOLD_MS) {
      this.flash.alpha = 1;
      return;
    }
    const fade = (this.flashAgeMs - FLASH_HOLD_MS) / FLASH_FADE_MS;
    this.flash.alpha = Math.max(0, 1 - fade);
  }

  dispose(): void {
    for (const off of this.unsubscribes) off();
    this.unsubscribes.length = 0;
  }
}
