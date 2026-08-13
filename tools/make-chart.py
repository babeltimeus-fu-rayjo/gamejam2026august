#!/usr/bin/env python3
"""Generate a chart.json from an audio file for game/public/songs/<id>/.

Usage:
    python tools/make-chart.py SOURCE.wav OUT/chart.json TITLE AUDIO_FILE DURATION

Analysis (librosa) drives everything:
  - tempo + beat grid give the chart's bpm/offset, and every note snaps to a
    16th-note subdivision of that grid so the result feels authored, not traced;
  - onset strength picks which subdivisions get a note, thinned to the
    2.5-3.5 notes/sec band the hand-authored charts sit in, denser where the
    music is loud, sparser in the lulls;
  - the spectral centroid at each onset chooses the lane (low sounds on the
    left, high on the right), then per-lane gap rules break up jacks;
  - onsets whose energy sustains with no follow-up onset become holds,
    clamped to the 0.375-2s range the existing charts use.

Matches the shipped chart style: 4 lanes, single notes only (no chords).
"""

import json
import sys

import librosa
import numpy as np

LANES = 4
# Global density control: strongest onsets are kept first until the budget
# (notes/sec) is spent; MIN_GAP then keeps bursts physically playable.
TARGET_NPS = 3.0
MIN_GAP = 0.14
LANE_GAP = 0.30  # same-lane repeat spacing (anti-jack)
HOLD_MIN, HOLD_MAX = 0.4, 2.0


def main(src: str, out: str, title: str, audio_file: str, duration: float) -> None:
    y, sr = librosa.load(src, mono=True)
    hop = 512

    # --- beat grid ---
    tempo, beats = librosa.beat.beat_track(y=y, sr=sr, hop_length=hop, units="time")
    bpm = float(np.atleast_1d(tempo)[0])
    period = 60.0 / bpm
    # beat 0 = first tracked beat pulled back to just after audio start.
    offset = float(beats[0] % period) if len(beats) else 0.0
    grid = period / 4.0  # 16ths

    # --- onsets ---
    env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop)
    onset_f = librosa.onset.onset_detect(
        onset_envelope=env, sr=sr, hop_length=hop, backtrack=False
    )
    onset_t = librosa.frames_to_time(onset_f, sr=sr, hop_length=hop)
    strength = env[onset_f]

    # snap to the 16th grid, drop anything that lands past the audio
    snapped = np.round((onset_t - offset) / grid) * grid + offset
    keep = (snapped >= 0) & (snapped < duration - 0.05)
    snapped, strength = snapped[keep], strength[keep]

    # dedupe grid cells, keeping the strongest hit in each
    cells: dict[int, float] = {}
    for t, s in zip(snapped, strength):
        c = round((t - offset) / grid)
        cells[c] = max(cells.get(c, 0.0), float(s))
    times = np.array(sorted(cells))
    strengths = np.array([cells[c] for c in times])
    times = times * grid + offset

    # --- density: keep strongest onsets up to the budget, then re-sort ---
    budget = int(TARGET_NPS * duration)
    order = np.argsort(-strengths)[:budget]
    chosen = np.sort(times[order])
    kept = []
    for t in chosen:
        if not kept or t - kept[-1] >= MIN_GAP:
            kept.append(float(t))

    # --- lanes from pitch register ---
    cent = librosa.feature.spectral_centroid(y=y, sr=sr, hop_length=hop)[0]
    cent_t = librosa.frames_to_time(np.arange(len(cent)), sr=sr, hop_length=hop)
    note_cent = np.interp(kept, cent_t, cent)
    lo, hi = np.percentile(note_cent, 10), np.percentile(note_cent, 90)

    # --- holds: sustained energy with no follow-up onset ---
    rms = librosa.feature.rms(y=y, hop_length=hop)[0]
    rms_t = librosa.frames_to_time(np.arange(len(rms)), sr=sr, hop_length=hop)
    floor = np.percentile(rms, 30)

    notes = []
    lane_free = [-1e9] * LANES
    last_lane = -1
    for i, t in enumerate(kept):
        frac = (note_cent[i] - lo) / max(hi - lo, 1e-9)
        lane = int(np.clip(round(frac * (LANES - 1)), 0, LANES - 1))
        # nudge off blocked/jacky lanes to the nearest free neighbour
        options = sorted(range(LANES), key=lambda l: abs(l - lane))
        lane = next(
            (l for l in options if t >= lane_free[l] and l != last_lane),
            next((l for l in options if t >= lane_free[l]), -1),
        )
        if lane < 0:
            continue

        gap = (kept[i + 1] - t) if i + 1 < len(kept) else (duration - t)
        d = 0.0
        if gap >= HOLD_MIN + 0.1:
            # sustain length = how long RMS stays above the floor after t
            span = rms[(rms_t >= t) & (rms_t <= t + min(gap - 0.1, HOLD_MAX))]
            sustained = (
                float(len(span[: np.argmax(span < floor)]) if np.any(span < floor) else len(span))
                * hop
                / sr
            )
            if sustained >= HOLD_MIN:
                d = round(min(sustained, HOLD_MAX, gap - 0.1), 3)

        note = {"t": round(t, 3), "lane": lane, "type": "hold" if d else "tap"}
        if d:
            note["d"] = d
        notes.append(note)
        lane_free[lane] = t + (d if d else 0) + LANE_GAP
        last_lane = lane

    chart = {
        "version": 1,
        "song": {
            "title": title,
            "artist": "",
            "audioFile": audio_file,
            "duration": round(duration, 3),
        },
        "bpm": round(bpm, 3),
        "offset": round(offset, 4),
        "lanes": LANES,
        "notes": notes,
    }
    with open(out, "w", encoding="utf-8") as f:
        json.dump(chart, f, indent=1)
    holds = sum(1 for n in notes if n["type"] == "hold")
    print(
        f"{out}: bpm={bpm:.1f} offset={offset:.3f} notes={len(notes)} "
        f"holds={holds} nps={len(notes) / duration:.2f}"
    )


if __name__ == "__main__":
    if len(sys.argv) != 6:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], float(sys.argv[5]))
