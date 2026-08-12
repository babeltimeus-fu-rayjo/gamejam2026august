// Bootstrapping and wiring: toolbar, keyboard, file loading, analysis worker,
// auto-chart generation, render loop.
import { AudioEngine } from "./audio.js";
import { computePeaks, drawWaveform } from "./waveform.js";
import { Chart, LANES } from "./chart.js";
import { Editor } from "./editor.js";
import { exportChart, importChartFile, scheduleAutosave, findAutosave, clearAutosave } from "./export.js";

const $ = (id) => document.getElementById(id);

const audio = new AudioEngine();
const chart = new Chart();
const view = { start: 0, pps: 100 };

const waveCanvas = $("waveCanvas");
const waveCtx = waveCanvas.getContext("2d");
const editor = new Editor($("laneCanvas"), chart, view);
editor.getDuration = () => audio.duration;

let peaks = null;
let onsets = [];          // last analysis result: [{t, strength, low, mid, high}]
let showOnsets = true;
let analysisState = "idle"; // idle | running | done

audio.getBpm = () => chart.bpm;
audio.getOffset = () => chart.offset;
audio.getNotes = () => chart.notes;

chart.onChange = () => {
  scheduleAutosave(chart);
  syncFields();
};
editor.onEdit = () => scheduleAutosave(chart);

// ---------- Analysis worker ----------
const worker = new Worker("./analysis-worker.js", { type: "module" });
worker.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === "progress") {
    $("statusInfo").textContent = `Analyzing… ${Math.round(msg.value * 100)}%`;
  } else if (msg.type === "result") {
    onsets = msg.onsets;
    analysisState = "done";
    $("btnGenerate").disabled = false;
    $("btnAnalyze").disabled = false;
    $("statusInfo").textContent = `Analysis: ${onsets.length} onsets`;
    renderBpmCandidates(msg.bpmCandidates);
    if (msg.bpmCandidates.length) {
      chart.setBpmOffset(msg.bpmCandidates[0].bpm, msg.offset);
    }
  } else if (msg.type === "onsets") {
    onsets = msg.onsets;
    $("statusInfo").textContent = `Analysis: ${onsets.length} onsets`;
  } else if (msg.type === "offset") {
    chart.setBpmOffset(msg.bpm, msg.offset);
  }
};

function renderBpmCandidates(cands) {
  const el = $("bpmCandidates");
  el.innerHTML = "";
  for (const c of cands) {
    const b = document.createElement("button");
    b.textContent = `${c.bpm}`;
    b.title = `Use ${c.bpm} BPM (score ${c.score.toFixed(2)}) and re-fit offset`;
    b.onclick = () => worker.postMessage({ cmd: "offsetFor", bpm: c.bpm });
    el.appendChild(b);
  }
}

function startAnalysis() {
  if (!audio.mono || analysisState === "running") return;
  analysisState = "running";
  $("btnAnalyze").disabled = true;
  $("statusInfo").textContent = "Analyzing… 0%";
  // Copy — the original mono stays for waveform rendering
  const copy = audio.mono.slice();
  worker.postMessage(
    { cmd: "analyze", mono: copy, sampleRate: audio.buffer.sampleRate, sensitivity: parseFloat($("inpSens").value) },
    [copy.buffer]
  );
}

// ---------- Auto-chart generation (main thread — cheap, re-runnable) ----------
const MAX_NOTES_PER_SEC = 7;
function generateNotes() {
  if (!onsets.length || !(chart.bpm > 0)) return [];
  const tick = 60 / chart.bpm / 4; // 1/4-beat grid
  // 1. Snap onsets to the grid, keep the strongest per tick
  const byTick = new Map();
  for (const o of onsets) {
    const k = Math.round((o.t - chart.offset) / tick);
    const t = chart.offset + k * tick;
    if (t < 0 || t > audio.duration) continue;
    const cur = byTick.get(k);
    if (!cur || o.strength > cur.strength) byTick.set(k, { ...o, t });
  }
  let list = [...byTick.values()].sort((a, b) => a.t - b.t);

  // 2. Global density cap: strongest-first, ≤ MAX_NOTES_PER_SEC in any ±1 s window
  const accepted = [];
  for (const o of [...list].sort((a, b) => b.strength - a.strength)) {
    let around = 0;
    for (const a of accepted) if (Math.abs(a.t - o.t) <= 1) around++;
    if (around < MAX_NOTES_PER_SEC) accepted.push(o);
  }
  list = accepted.sort((a, b) => a.t - b.t);

  // 3. Lane assignment by dominant band, with jack avoidance
  const notes = [];
  let midToggle = 1;
  for (const o of list) {
    let lane;
    if (o.low >= o.mid && o.low >= o.high) lane = 0;
    else if (o.high >= o.mid) lane = 3;
    else { lane = midToggle; midToggle = midToggle === 1 ? 2 : 1; }
    const prev = notes[notes.length - 1];
    if (prev && prev.lane === lane && o.t - prev.t < 0.13) {
      lane = lane === 0 ? 1 : lane === 3 ? 2 : lane === 1 ? 2 : 1;
    }
    notes.push({ t: o.t, lane, type: "tap" });
  }
  return notes;
}

$("btnGenerate").addEventListener("click", () => {
  const notes = generateNotes();
  if (!notes.length) return;
  if (chart.notes.length && !confirm(`Replace the current ${chart.notes.length} notes with ${notes.length} generated notes? (undoable with Ctrl+Z)`)) return;
  editor.selection.clear();
  chart.replaceAllNotes(notes);
  $("statusInfo").textContent = `Generated ${notes.length} notes`;
});

// ---------- File loading ----------
async function loadAudioFile(file) {
  $("statusInfo").textContent = `Decoding ${file.name}…`;
  try {
    await audio.load(file);
  } catch (err) {
    $("statusInfo").textContent = `Could not decode ${file.name}: ${err.message || err}`;
    return;
  }
  peaks = computePeaks(audio.mono, audio.buffer.sampleRate);
  onsets = [];
  analysisState = "idle";
  chart.song.audioFile = file.name;
  chart.song.duration = audio.duration;
  if (!chart.song.title) chart.song.title = file.name.replace(/\.[^.]+$/, "");
  $("btnAnalyze").disabled = false;
  $("btnGenerate").disabled = true;
  $("dropHint").classList.add("hidden");
  view.start = 0;
  $("statusInfo").textContent = `Loaded ${file.name} (${fmtTime(audio.duration)})`;
  syncFields();

  const saved = findAutosave(chart);
  if (saved && saved.notes?.length && confirm(`Autosave found for this song (${saved.notes.length} notes). Restore it?`)) {
    try { chart.loadSerialized(saved); } catch (err) { alert(`Autosave was corrupt: ${err.message}`); }
    syncFields();
  }
}

$("btnLoad").addEventListener("click", () => $("fileAudio").click());
$("fileAudio").addEventListener("change", (e) => {
  if (e.target.files[0]) loadAudioFile(e.target.files[0]);
  e.target.value = "";
});
$("btnImport").addEventListener("click", () => $("fileChart").click());
$("fileChart").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  e.target.value = "";
  if (!f) return;
  try {
    await importChartFile(chart, f);
    editor.selection.clear();
    syncFields();
    $("statusInfo").textContent = `Imported ${f.name} (${chart.notes.length} notes)`;
  } catch (err) {
    alert(`Import failed: ${err.message}`);
  }
});
$("btnExport").addEventListener("click", doExport);
function doExport() {
  exportChart(chart);
  clearAutosave(chart);
  $("statusInfo").textContent = "Exported chart.json";
}

// Drag & drop (audio or chart.json)
document.body.addEventListener("dragover", (e) => { e.preventDefault(); document.body.classList.add("dragover"); });
document.body.addEventListener("dragleave", () => document.body.classList.remove("dragover"));
document.body.addEventListener("drop", async (e) => {
  e.preventDefault();
  document.body.classList.remove("dragover");
  const file = e.dataTransfer.files[0];
  if (!file) return;
  if (file.name.endsWith(".json")) {
    try { await importChartFile(chart, file); syncFields(); } catch (err) { alert(`Import failed: ${err.message}`); }
  } else {
    loadAudioFile(file);
  }
});

// ---------- Toolbar ----------
$("btnPlay").addEventListener("click", () => audio.toggle());
$("rateSelect").addEventListener("change", (e) => audio.setRate(parseFloat(e.target.value)));
$("chkMetronome").addEventListener("change", (e) => (audio.metronomeOn = e.target.checked));
$("chkHitsounds").addEventListener("change", (e) => (audio.hitsoundsOn = e.target.checked));

$("inpBpm").addEventListener("change", (e) => {
  const v = parseFloat(e.target.value);
  if (v > 0) chart.setBpmOffset(v, chart.offset);
});
$("inpOffset").addEventListener("change", (e) => {
  const v = parseFloat(e.target.value);
  if (!isNaN(v)) chart.setBpmOffset(chart.bpm, v);
});
$("btnHalf").addEventListener("click", () => chart.setBpmOffset(Math.round(chart.bpm / 2 * 10) / 10, chart.offset));
$("btnDouble").addEventListener("click", () => chart.setBpmOffset(Math.round(chart.bpm * 2 * 10) / 10, chart.offset));
$("btnOffMinus").addEventListener("click", () => chart.setBpmOffset(chart.bpm, Math.round((chart.offset - 0.01) * 1000) / 1000));
$("btnOffPlus").addEventListener("click", () => chart.setBpmOffset(chart.bpm, Math.round((chart.offset + 0.01) * 1000) / 1000));
$("snapSelect").addEventListener("change", (e) => (editor.snapDivision = parseInt(e.target.value, 10)));
$("btnAnalyze").addEventListener("click", startAnalysis);

let sensTimer = null;
$("inpSens").addEventListener("input", (e) => {
  if (analysisState !== "done") return;
  clearTimeout(sensTimer);
  sensTimer = setTimeout(() => worker.postMessage({ cmd: "repick", sensitivity: parseFloat(e.target.value) }), 120);
});

$("inpTitle").addEventListener("change", (e) => { chart.song.title = e.target.value; scheduleAutosave(chart); });
$("inpArtist").addEventListener("change", (e) => { chart.song.artist = e.target.value; scheduleAutosave(chart); });

// Tap tempo
let taps = [];
function tapTempo() {
  const now = audio.playing ? audio.time : performance.now() / 1000;
  audio.clickNow(1400);
  if (taps.length && now - taps[taps.length - 1] > 2) taps = [];
  taps.push(now);
  if (taps.length < 3) { $("statusInfo").textContent = `Tap… (${taps.length})`; return; }
  const recent = taps.slice(-9);
  let sum = 0;
  for (let i = 1; i < recent.length; i++) sum += recent[i] - recent[i - 1];
  const bpm = Math.round((60 / (sum / (recent.length - 1))) * 10) / 10;
  const beatSec = 60 / bpm;
  // If tapping along to playback, first tap of the series fixes the phase
  const offset = audio.playing ? Math.round((taps[0] % beatSec) * 1000) / 1000 : chart.offset;
  chart.setBpmOffset(bpm, offset);
  $("statusInfo").textContent = `Tap tempo: ${bpm} BPM (${taps.length} taps)`;
}
$("btnTap").addEventListener("click", tapTempo);

// ---------- Keyboard ----------
const SNAP_VALUES = [1, 2, 3, 4, 6, 8, 12, 16];
const KEY_LANES = { KeyD: 0, KeyF: 1, KeyJ: 2, KeyK: 3 };

// Some environments deliver key events without e.code — normalize from e.key.
function normalizeCode(e) {
  if (e.code) return e.code;
  const k = e.key;
  if (/^[a-zA-Z]$/.test(k)) return "Key" + k.toUpperCase();
  return { " ": "Space", "[": "BracketLeft", "]": "BracketRight", "=": "Equal", "+": "Equal", "-": "Minus" }[k] || k;
}

window.addEventListener("keydown", (e) => {
  const tag = e.target.tagName;
  if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
  const code = normalizeCode(e);
  if (e.repeat && !["ArrowLeft", "ArrowRight"].includes(code)) return;

  if (e.ctrlKey || e.metaKey) {
    if (code === "KeyZ") { e.preventDefault(); e.shiftKey ? chart.redo() : chart.undo(); }
    else if (code === "KeyY") { e.preventDefault(); chart.redo(); }
    else if (code === "KeyS") { e.preventDefault(); doExport(); }
    else if (code === "KeyA") { e.preventDefault(); for (const n of chart.notes) editor.selection.add(n); }
    return;
  }

  switch (code) {
    case "Space":
      e.preventDefault();
      audio.toggle();
      break;
    case "Home": audio.seek(0); break;
    case "End": audio.seek(audio.duration); break;
    case "ArrowLeft":
    case "ArrowRight": {
      e.preventDefault();
      const step = chart.bpm > 0 ? 60 / chart.bpm / editor.snapDivision : 0.25;
      const dir = code === "ArrowLeft" ? -1 : 1;
      const t = chart.snapTime(audio.time + dir * step, editor.snapDivision);
      audio.seek(Math.max(0, Math.min(t, audio.duration)));
      break;
    }
    case "Delete":
    case "Backspace":
      editor.deleteSelection();
      break;
    case "KeyM":
      audio.metronomeOn = !audio.metronomeOn;
      $("chkMetronome").checked = audio.metronomeOn;
      break;
    case "KeyH":
      audio.hitsoundsOn = !audio.hitsoundsOn;
      $("chkHitsounds").checked = audio.hitsoundsOn;
      break;
    case "KeyT": tapTempo(); break;
    case "KeyO": showOnsets = !showOnsets; break;
    case "BracketLeft":
    case "BracketRight": {
      const i = SNAP_VALUES.indexOf(editor.snapDivision);
      const j = Math.max(0, Math.min(SNAP_VALUES.length - 1, i + (code === "BracketRight" ? 1 : -1)));
      editor.snapDivision = SNAP_VALUES[j];
      $("snapSelect").value = String(editor.snapDivision);
      break;
    }
    case "Equal":
    case "NumpadAdd":
    case "Minus":
    case "NumpadSubtract": {
      const rates = [0.25, 0.5, 0.75, 1];
      const dir = code === "Equal" || code === "NumpadAdd" ? 1 : -1;
      const i = Math.max(0, Math.min(rates.length - 1, rates.indexOf(audio.rate) + dir));
      audio.setRate(rates[i]);
      $("rateSelect").value = String(rates[i]);
      break;
    }
    default: {
      // D F J K — place a tap at the (snapped) playhead in that lane
      const lane = KEY_LANES[code];
      if (lane !== undefined && audio.buffer) {
        const t = chart.snapTime(audio.time, editor.snapDivision);
        const dup = chart.notes.some((n) => n.lane === lane && Math.abs(n.t - t) < 0.025);
        if (!dup && t >= 0 && t <= audio.duration) {
          chart.addNote({ t: Math.max(0, t), lane, type: "tap" });
          audio.clickNow(2000);
          scheduleAutosave(chart);
        }
      }
    }
  }
});

// ---------- Waveform seek/scrub ----------
let scrubbing = false;
let lastScrubTick = 0;
waveCanvas.addEventListener("mousedown", (e) => {
  if (!audio.buffer) return;
  scrubbing = true;
  seekFromWave(e);
});
window.addEventListener("mousemove", (e) => { if (scrubbing) seekFromWave(e); });
window.addEventListener("mouseup", () => (scrubbing = false));
function seekFromWave(e) {
  const r = waveCanvas.getBoundingClientRect();
  const t = Math.max(0, Math.min(view.start + (e.clientX - r.left) / view.pps, audio.duration));
  audio.seek(t);
  const now = performance.now();
  if (!audio.playing && now - lastScrubTick > 70) {
    lastScrubTick = now;
    audio.scrubTick(t);
  }
}
waveCanvas.addEventListener("wheel", (e) => editor._onWheel(e), { passive: false });

// ---------- Render loop ----------
function fmtTime(t) {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, "0")}`;
}

function frame() {
  const t = audio.time;

  // Auto-scroll: keep the playhead in view while playing
  if (audio.playing) {
    const w = editor.canvas.clientWidth;
    const px = (t - view.start) * view.pps;
    if (px > w * 0.85 || px < 0) view.start = Math.max(0, t - (w * 0.15) / view.pps);
  }

  // Waveform (with DPR sizing) + onset ghosts + playhead
  const dpr = window.devicePixelRatio || 1;
  const ww = waveCanvas.clientWidth, wh = waveCanvas.clientHeight;
  if (waveCanvas.width !== ww * dpr || waveCanvas.height !== wh * dpr) {
    waveCanvas.width = ww * dpr;
    waveCanvas.height = wh * dpr;
  }
  waveCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawWaveform(waveCtx, peaks, view, ww, wh, showOnsets ? onsets : null);
  const px = (t - view.start) * view.pps;
  if (px >= 0 && px <= ww) {
    waveCtx.strokeStyle = "#fff";
    waveCtx.beginPath();
    waveCtx.moveTo(px, 0);
    waveCtx.lineTo(px, wh);
    waveCtx.stroke();
  }

  editor.render(t);

  // Toolbar / status
  $("btnPlay").textContent = audio.playing ? "⏸" : "▶";
  $("timeDisplay").textContent = fmtTime(t);
  if (editor.mouse.inside) {
    const mt = editor.xToTime(editor.mouse.x);
    const beat = chart.timeToBeat(mt);
    $("statusCursor").textContent = `${fmtTime(Math.max(0, mt))}  ·  beat ${beat.toFixed(2)}  ·  lane ${editor.yToLane(editor.mouse.y)}`;
  } else {
    $("statusCursor").textContent = "";
  }
  const holds = chart.notes.reduce((a, n) => a + (n.type === "hold" ? 1 : 0), 0);
  $("statusNotes").textContent = `${chart.notes.length} notes (${holds} holds) · sel ${editor.selection.size}`;

  requestAnimationFrame(frame);
}

function syncFields() {
  $("inpBpm").value = chart.bpm;
  $("inpOffset").value = chart.offset;
  $("inpTitle").value = chart.song.title;
  $("inpArtist").value = chart.song.artist;
}

syncFields();
requestAnimationFrame(frame);

// Debug/console access (also handy for quick scripting)
window.__app = { audio, chart, editor, view, getOnsets: () => onsets };
