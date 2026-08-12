// Minimal iterative radix-2 FFT (real input convenience wrapper).
// Used by the analysis worker; no dependencies.

export class FFT {
  constructor(size) {
    if ((size & (size - 1)) !== 0) throw new Error("FFT size must be a power of 2");
    this.size = size;
    this.rev = new Uint32Array(size);
    const bits = Math.log2(size);
    for (let i = 0; i < size; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r = (r << 1) | ((i >> b) & 1);
      this.rev[i] = r;
    }
    // Precompute twiddles per stage
    this.cos = new Float32Array(size / 2);
    this.sin = new Float32Array(size / 2);
    for (let i = 0; i < size / 2; i++) {
      const a = (-2 * Math.PI * i) / size;
      this.cos[i] = Math.cos(a);
      this.sin[i] = Math.sin(a);
    }
    this.re = new Float32Array(size);
    this.im = new Float32Array(size);
  }

  // input: Float32Array length >= size (real). out: magnitudes for bins 0..size/2
  magnitudes(input, window, outMag) {
    const n = this.size, re = this.re, im = this.im, rev = this.rev;
    for (let i = 0; i < n; i++) {
      re[rev[i]] = input[i] * window[i];
      im[rev[i]] = 0;
    }
    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1;
      const step = n / len;
      for (let i = 0; i < n; i += len) {
        for (let j = 0; j < half; j++) {
          const k = j * step;
          const c = this.cos[k], s = this.sin[k];
          const pr = re[i + j + half], pi = im[i + j + half];
          const tr = pr * c - pi * s;
          const ti = pr * s + pi * c;
          re[i + j + half] = re[i + j] - tr;
          im[i + j + half] = im[i + j] - ti;
          re[i + j] += tr;
          im[i + j] += ti;
        }
      }
    }
    const bins = n / 2;
    for (let i = 0; i <= bins; i++) {
      const idx = i === bins ? bins : i; // bin n/2 == Nyquist
      outMag[i] = Math.hypot(re[idx], im[idx]);
    }
    return outMag;
  }
}

export function hannWindow(size) {
  const w = new Float32Array(size);
  for (let i = 0; i < size; i++) w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
  return w;
}
