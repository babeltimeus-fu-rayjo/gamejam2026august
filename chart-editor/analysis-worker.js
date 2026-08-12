// Analysis worker: spectral-flux onset detection, BPM + offset estimation.
// Loaded with new Worker("analysis-worker.js", { type: "module" }).
import { FFT, hannWindow } from "./fft.js";

const FFT_SIZE = 1024;
const HOP = 256;
const TARGET_RATE = 22050;
// Seconds subtracted from raw frame time; tune if markers sit consistently late.
const ONSET_BIAS = 0.012;

// Cached between "analyze" and "repick" messages
let cache = null; // { flux, low, mid, high, fps, bpmCandidates, offsetForBpm }

self.onmessage = (e) => {
  const msg = e.data;
  if (msg.cmd === "analyze") {
    analyze(msg.mono, msg.sampleRate, msg.sensitivity);
  } else if (msg.cmd === "repick") {
    if (!cache) return;
    const onsets = pickOnsets(cache, msg.sensitivity);
    self.postMessage({ type: "onsets", onsets });
  } else if (msg.cmd === "offsetFor") {
    if (!cache) return;
    self.postMessage({ type: "offset", bpm: msg.bpm, offset: estimateOffset(cache, msg.bpm) });
  }
};

function analyze(mono, sampleRate, sensitivity) {
  // --- Downsample by integer factor (simple averaging) ---
  const factor = Math.max(1, Math.round(sampleRate / TARGET_RATE));
  const dsRate = sampleRate / factor;
  const n = Math.floor(mono.length / factor);
  const sig = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    const base = i * factor;
    for (let j = 0; j < factor; j++) s += mono[base + j];
    sig[i] = s / factor;
  }

  // --- Spectral flux (total + 3 bands) ---
  const frames = Math.max(0, Math.floor((n - FFT_SIZE) / HOP));
  const fps = dsRate / HOP;
  const flux = new Float32Array(frames);
  const low = new Float32Array(frames);
  const mid = new Float32Array(frames);
  const high = new Float32Array(frames);

  const fft = new FFT(FFT_SIZE);
  const win = hannWindow(FFT_SIZE);
  const bins = FFT_SIZE / 2 + 1;
  const mag = new Float32Array(bins);
  const prev = new Float32Array(bins);
  const binHz = dsRate / FFT_SIZE;
  const bLow = [Math.ceil(20 / binHz), Math.floor(150 / binHz)];
  const bMid = [Math.floor(150 / binHz) + 1, Math.floor(2000 / binHz)];
  const bHigh = [Math.floor(2000 / binHz) + 1, Math.min(bins - 1, Math.floor(8000 / binHz))];

  const frame = new Float32Array(FFT_SIZE);
  let lastProgress = 0;
  for (let f = 0; f < frames; f++) {
    frame.set(sig.subarray(f * HOP, f * HOP + FFT_SIZE));
    fft.magnitudes(frame, win, mag);
    let total = 0, lo = 0, mi = 0, hi = 0;
    for (let k = 1; k < bins; k++) {
      const d = mag[k] - prev[k];
      if (d > 0) {
        total += d;
        if (k >= bLow[0] && k <= bLow[1]) lo += d;
        else if (k >= bMid[0] && k <= bMid[1]) mi += d;
        else if (k >= bHigh[0] && k <= bHigh[1]) hi += d;
      }
    }
    flux[f] = total; low[f] = lo; mid[f] = mi; high[f] = hi;
    prev.set(mag);
    const p = f / frames;
    if (p - lastProgress >= 0.05) {
      lastProgress = p;
      self.postMessage({ type: "progress", value: p });
    }
  }

  // Normalize + light smoothing (3-frame moving average)
  smoothNormalize(flux);
  cache = { flux, low, mid, high, fps };

  // --- BPM + offset ---
  const bpmCandidates = estimateBpm(cache);
  const bestBpm = bpmCandidates.length ? bpmCandidates[0].bpm : 120;
  const offset = estimateOffset(cache, bestBpm);
  const onsets = pickOnsets(cache, sensitivity);

  self.postMessage({ type: "result", onsets, bpmCandidates, offset });
}

function smoothNormalize(arr) {
  let max = 0;
  for (let i = 0; i < arr.length; i++) if (arr[i] > max) max = arr[i];
  if (max > 0) for (let i = 0; i < arr.length; i++) arr[i] /= max;
  const copy = Float32Array.from(arr);
  for (let i = 1; i < arr.length - 1; i++) arr[i] = (copy[i - 1] + copy[i] + copy[i + 1]) / 3;
}

function pickOnsets({ flux, low, mid, high, fps }, sensitivity) {
  const onsets = [];
  const W = 10;            // mean window (frames each side)
  const LOCAL = 3;         // local-max window
  const DEBOUNCE = 5;      // frames (~58 ms)
  const FLOOR = 0.01;
  let lastAccepted = -Infinity;
  for (let i = LOCAL; i < flux.length - LOCAL; i++) {
    const v = flux[i];
    let isMax = true;
    for (let j = i - LOCAL; j <= i + LOCAL; j++) if (flux[j] > v) { isMax = false; break; }
    if (!isMax) continue;
    let sum = 0, count = 0;
    for (let j = Math.max(0, i - W); j <= Math.min(flux.length - 1, i + W); j++) { sum += flux[j]; count++; }
    if (v <= (sum / count) * sensitivity + FLOOR) continue;
    if (i - lastAccepted < DEBOUNCE) continue;
    lastAccepted = i;
    onsets.push({
      t: Math.max(0, i / fps - ONSET_BIAS),
      strength: v,
      low: low[i],
      mid: mid[i],
      high: high[i],
    });
  }
  return onsets;
}

function estimateBpm({ flux, fps }) {
  const n = flux.length;
  if (n < fps * 5) return [];
  let mean = 0;
  for (let i = 0; i < n; i++) mean += flux[i];
  mean /= n;
  const env = new Float32Array(n);
  for (let i = 0; i < n; i++) env[i] = flux[i] - mean;

  const lagMin = Math.max(2, Math.floor((fps * 60) / 200)); // 200 BPM
  const lagMax = Math.min(n - 1, Math.ceil((fps * 60) / 60)); // 60 BPM
  const acfMax = Math.min(n - 1, lagMax * 2 + 2);
  const acf = new Float32Array(acfMax + 1);
  for (let lag = 0; lag <= acfMax; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += env[i] * env[i + lag];
    acf[lag] = s / (n - lag);
  }
  const norm = acf[0] || 1;
  for (let i = 0; i <= acfMax; i++) acf[i] /= norm;

  // Score each lag with harmonic reinforcement, collect local maxima
  const score = (lag) => acf[lag] + (2 * lag <= acfMax ? 0.5 * acf[2 * lag] : 0);
  const peaks = [];
  for (let lag = lagMin + 1; lag < lagMax; lag++) {
    const s = score(lag);
    if (s > score(lag - 1) && s >= score(lag + 1)) peaks.push({ lag, s });
  }
  peaks.sort((a, b) => b.s - a.s);

  const candidates = [];
  for (const p of peaks) {
    // Parabolic interpolation on the ACF for sub-frame lag precision
    const y0 = acf[p.lag - 1], y1 = acf[p.lag], y2 = acf[p.lag + 1];
    const denom = y0 - 2 * y1 + y2;
    const shift = denom !== 0 ? (0.5 * (y0 - y2)) / denom : 0;
    const lag = p.lag + Math.max(-0.5, Math.min(0.5, shift));
    const bpm = (60 * fps) / lag;
    // Skip near-duplicates of an already-kept candidate
    if (candidates.some((c) => Math.abs(c.bpm - bpm) < 2)) continue;
    candidates.push({ bpm: Math.round(bpm * 10) / 10, score: p.s });
    if (candidates.length >= 3) break;
  }
  return candidates;
}

function estimateOffset({ flux, fps }, bpm) {
  const period = (fps * 60) / bpm; // frames per beat
  if (!(period > 1)) return 0;
  const PHASES = 32;
  let bestPhase = 0, bestScore = -Infinity;
  for (let p = 0; p < PHASES; p++) {
    const phi = (p / PHASES) * period;
    let s = 0;
    for (let f = phi; f < flux.length; f += period) {
      const i = Math.round(f);
      // ±1 frame tolerance
      let v = flux[i] || 0;
      if (i > 0 && flux[i - 1] > v) v = flux[i - 1];
      if (i + 1 < flux.length && flux[i + 1] > v) v = flux[i + 1];
      s += v;
    }
    if (s > bestScore) { bestScore = s; bestPhase = phi; }
  }
  const offset = bestPhase / fps;
  const beatSec = 60 / bpm;
  return Math.round((offset % beatSec) * 1000) / 1000;
}
