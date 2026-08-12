// Waveform peak extraction and canvas rendering.

const SAMPLES_PER_BUCKET = 256;

export function computePeaks(mono, sampleRate) {
  const buckets = Math.ceil(mono.length / SAMPLES_PER_BUCKET);
  const min = new Float32Array(buckets);
  const max = new Float32Array(buckets);
  for (let b = 0; b < buckets; b++) {
    let lo = Infinity, hi = -Infinity;
    const start = b * SAMPLES_PER_BUCKET;
    const end = Math.min(start + SAMPLES_PER_BUCKET, mono.length);
    for (let i = start; i < end; i++) {
      const v = mono[i];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    min[b] = lo === Infinity ? 0 : lo;
    max[b] = hi === -Infinity ? 0 : hi;
  }
  return { min, max, bucketsPerSecond: sampleRate / SAMPLES_PER_BUCKET };
}

// view: { start (sec), pps (px/sec) }
export function drawWaveform(ctx, peaks, view, width, height, onsets) {
  ctx.clearRect(0, 0, width, height);
  if (!peaks) return;
  const mid = height / 2;
  ctx.fillStyle = "#3d6fa8";
  const { min, max, bucketsPerSecond } = peaks;
  for (let x = 0; x < width; x++) {
    const t0 = view.start + x / view.pps;
    const t1 = view.start + (x + 1) / view.pps;
    let b0 = Math.floor(t0 * bucketsPerSecond);
    let b1 = Math.max(b0 + 1, Math.ceil(t1 * bucketsPerSecond));
    if (b1 <= 0 || b0 >= min.length) continue;
    b0 = Math.max(0, b0);
    b1 = Math.min(min.length, b1);
    let lo = Infinity, hi = -Infinity;
    for (let b = b0; b < b1; b++) {
      if (min[b] < lo) lo = min[b];
      if (max[b] > hi) hi = max[b];
    }
    if (lo === Infinity) continue;
    const y0 = mid - hi * mid * 0.95;
    const y1 = mid - lo * mid * 0.95;
    ctx.fillRect(x, y0, 1, Math.max(1, y1 - y0));
  }
  // Onset ghost markers
  if (onsets && onsets.length) {
    ctx.strokeStyle = "rgba(255, 196, 0, 0.75)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const o of onsets) {
      const x = (o.t - view.start) * view.pps;
      if (x < 0 || x > width) continue;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height * 0.3);
    }
    ctx.stroke();
  }
}
