# gamejam2026august — Rhythm Game

Browser rhythm game (Magic Tiles 3 / DDR style): 4 vertical lanes, notes fall top-to-bottom into a hit line near the bottom, played with **D F J K**. PixiJS v8 + TypeScript + Vite.

**Read [PLAN.md](PLAN.md) first** — architecture, milestones (M0–M6), and team split live there.

**Play the latest build:** https://babeltimeus-fu-rayjo.github.io/gamejam2026august/ — every push to `main` auto-deploys via GitHub Actions.

## Run it

```bash
cd game
npm install
npm run dev     # dev server on http://localhost:8080
```

Other scripts (run inside `game/`):

| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server with hot reload (port 8080) |
| `npm run build` | Lint + typecheck + production build to `dist/` |
| `npm run lint` | ESLint (`-- --fix` to autoformat) |

## Chart editor

The charting/mapping tool lives in [`chart-editor/`](chart-editor/README.md) — a standalone web app (no npm install needed): load a song, auto-detect BPM/onsets, hand-edit taps and holds, export `chart.json` in the game's beatmap format, ready for `game/public/songs/<id>/`.

```bash
cd chart-editor
python -m http.server 8123    # then open http://localhost:8123
```

## Current state

**M2 (playable game) done:** gameplay loads `chart.json` (validated by `core/beatmap.ts`) and the song it names, drops pooled note sprites down all 4 lanes into the hit line, and scores hits through ±45/90/135 ms windows — score/combo and judgement popups render as BitmapText (`ui/hud.ts`), systems talk over a typed event bus (`core/events.ts`), and the results screen shows grade/score/accuracy/max-combo before looping back to the lobby. The current chart is a generated beat-grid placeholder (226 notes at 128 BPM) — real charting lands with the **M3** record-mode tool. Art renders full-screen behind the semi-transparent track.

**M6 (multiplayer, stretch) built:** pick **Battle** on the title screen, then `C` creates a room and `J` joins one by 4-letter code — peers pair over public Nostr relays via [Trystero](https://github.com/dmotz/trystero), with no server of ours. Both sides play the same chart locally ("mirror play"), so peer latency only delays the opponent's ghost, never your own inputs. During play a compact opponent readout pins to the top-right; results split into side-by-side columns with a win/lose/tie verdict. Both clients hash `chart.json` and refuse to start on a mismatch, and an `armed`/`go` handshake aligns the *audio* start rather than just the scene switch.

Caveat: verified with two browser tabs on one machine, which only exercises host candidates. **NAT traversal between two real networks is untested**, and the ~10–15 % of NAT combinations needing a TURN relay are out of scope — the lobby explains itself after 25 s alone.

## For Claude Code users

The repo vendors the official PixiJS v8 skills in `.claude/skills/` — Claude picks them up automatically when working here, no setup needed.
