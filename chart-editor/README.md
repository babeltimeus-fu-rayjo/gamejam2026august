# Chart Editor — 4K Rhythm

Browser charting tool for our 4-lane rhythm game. Load a song, auto-detect BPM/onsets, hand-edit taps and holds, export `chart.json` in the game's beatmap format.

## Run

```
cd chart-editor
python -m http.server 8123
```

Open http://localhost:8123 (a server is needed for ES modules; the audio itself is loaded via the file picker or drag-drop, nothing else is fetched).

## Workflow

1. **Load Audio** (or drop an mp3/ogg onto the page).
2. **Analyze** — detects onsets (yellow ticks on the waveform), BPM candidates, and offset. Click a candidate button to switch BPM (÷2/×2 if it picked half/double time). Verify with the **Metro** checkbox — ticks should stay locked to the music. If detection is off, use **Tap** (or `T`) to tap the tempo manually, and the ±10ms buttons to nudge the offset.
3. **Generate** — turns onsets into a playable tap chart (kicks→lane D, hats→lane K, mids alternate F/J, density-capped). Fully undoable.
4. Hand-edit (see controls), listening with **Hits** enabled at 0.5× rate for precision.
5. **Export** (`Ctrl+S`) — downloads `chart.json`, ready for `public/songs/<id>/` in the game repo.

Charts autosave to localStorage per song; you'll be offered a restore after re-loading the same audio file.

## Controls

| Input | Action |
|---|---|
| Click lane | Add tap (snapped to grid; hold `Alt` for free placement) |
| Drag from empty lane | Create hold |
| Drag note | Move (vertically = change lane) |
| Drag hold's right edge | Resize hold |
| Right-click / `Del` | Delete note(s) |
| Shift-click / Shift-drag | Multi-select |
| `Space` | Play/pause |
| `D F J K` | Place tap at playhead in that lane (play-along charting) |
| `←` `→` | Seek by one snap step; `Home`/`End` jump |
| `Ctrl+Z` / `Ctrl+Y` | Undo / redo |
| `Ctrl+A` | Select all |
| `Ctrl+S` | Export chart.json |
| `M` / `H` | Metronome / hitsounds |
| `T` | Tap tempo |
| `O` | Toggle onset markers |
| `[` `]` | Snap division down/up |
| `+` `-` | Playback rate |
| Wheel / `Ctrl`+wheel / middle-drag | Scroll / zoom / pan |
| Click or drag on waveform | Seek / scrub |

## Beatmap format

```json
{
  "version": 1,
  "song": { "title": "…", "artist": "…", "audioFile": "song.mp3", "duration": 160.836 },
  "bpm": 155.1,
  "offset": 0.024,
  "lanes": 4,
  "notes": [
    { "t": 1.812, "lane": 0, "type": "tap" },
    { "t": 2.281, "lane": 2, "type": "hold", "d": 0.938 }
  ]
}
```

Times are absolute seconds (lane 0 = D … lane 3 = K); `bpm`/`offset` are authoring metadata for the grid. Notes are sorted by `t`; `d` (seconds) only on holds.
