# gamejam2026august — Rhythm Game

Browser rhythm game (Magic Tiles 3 / DDR style): 4 horizontal lanes, notes scroll left-to-right into a hit line on the right edge, played with **D F J K**. PixiJS v8 + TypeScript + Vite.

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

**M1 (timing core) done:** gameplay plays the real song through the Web Audio clock (`core/clock.ts`) and scrolls a hardcoded lane-F test pattern into the right-edge hit line, with metronome clicks on note times, PERFECT/GREAT/GOOD/MISS judgements logged to the console (`game/judge.ts`, ±45/90/135 ms), and auto-advance to results. Art renders full-screen behind the semi-transparent track. Scene flow: Title → Lobby → Gameplay → Results → Lobby. Next up is **M2**: 4-lane charts from `chart.json` with scoring + HUD.

## For Claude Code users

The repo vendors the official PixiJS v8 skills in `.claude/skills/` — Claude picks them up automatically when working here, no setup needed.
