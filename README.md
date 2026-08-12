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

## Current state

**M0 (scaffold) done:** app boots into a 1280×720 letterboxed virtual canvas and cycles four placeholder scenes — Title → (any key) → Lobby → (Enter) → Gameplay wireframe → (Enter) → Results → (Enter) → back to Lobby. Next up is **M1**: the Web Audio timing core.

## For Claude Code users

The repo vendors the official PixiJS v8 skills in `.claude/skills/` — Claude picks them up automatically when working here, no setup needed.
