/**
 * Looping background music with a beat detector, for menu screens.
 *
 * Deliberately separate from AudioClock: that one is the gameplay timebase and
 * has to stay sample-accurate against a chart, whereas this only needs to loop
 * and report how hard the low end is hitting right now.
 *
 * Browsers refuse to start audio outside a user gesture. `play()` schedules the
 * source anyway — a source started on a suspended context begins as soon as the
 * context resumes — so callers just need to call `resume()` again from the first
 * pointer or key handler.
 */
export class Bgm {
  private readonly ctx = new AudioContext();
  private readonly gain: GainNode;
  private readonly analyser: AnalyserNode;
  private readonly bins: Uint8Array;
  /** Frequency bin range covering roughly 30-180 Hz: kick and bass. */
  private readonly lowFrom: number;
  private readonly lowTo: number;

  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;

  /** Fast follower on low-band energy, 0..1. Drives sustained brightness. */
  level = 0;
  /** Spike kicked to 1 on each detected onset, decaying to 0. */
  kick = 0;

  /** Slow running mean the onset test compares against. */
  private mean = 0;
  private sinceOnset = 1;

  constructor(volume = 0.55) {
    this.gain = this.ctx.createGain();
    this.gain.gain.value = volume;

    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.6;
    this.bins = new Uint8Array(this.analyser.frequencyBinCount);

    const binHz = this.ctx.sampleRate / this.analyser.fftSize;
    this.lowFrom = Math.max(1, Math.floor(30 / binHz));
    this.lowTo = Math.max(this.lowFrom + 1, Math.ceil(180 / binHz));

    this.gain.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);
  }

  get running(): boolean {
    return this.ctx.state === "running";
  }

  async load(url: string): Promise<void> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`bgm fetch failed: ${res.status} ${url}`);
    this.buffer = await this.ctx.decodeAudioData(await res.arrayBuffer());
  }

  /** Safe to call repeatedly from input handlers until `running` is true. */
  async resume(): Promise<boolean> {
    if (this.ctx.state !== "running") {
      try {
        await this.ctx.resume();
      } catch {
        // Still locked; the caller retries on the next user gesture.
      }
    }
    return this.running;
  }

  /** Start the loop. No-op if already playing or not loaded yet. */
  async play(): Promise<void> {
    if (!this.buffer || this.source) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.loop = true;
    src.connect(this.gain);
    src.start();
    this.source = src;
    await this.resume();
  }

  /**
   * Sample the spectrum and update `level` / `kick`. Call once per frame.
   *
   * Onset test is the standard one: compare instantaneous low-band energy
   * against a slow running mean, with a refractory window so a single kick
   * drum doesn't register three times as it decays.
   */
  sample(dt: number): void {
    this.kick = Math.max(0, this.kick - dt * 3.5);
    this.sinceOnset += dt;

    if (!this.running) {
      this.level += (0 - this.level) * Math.min(1, dt * 4);
      return;
    }

    this.analyser.getByteFrequencyData(this.bins);
    let sum = 0;
    for (let i = this.lowFrom; i < this.lowTo; i++) sum += this.bins[i];
    const now = sum / (this.lowTo - this.lowFrom) / 255;

    this.mean += (now - this.mean) * Math.min(1, dt * 1.2);

    // Report loudness relative to the running mean, not absolutely: a mastered
    // track keeps the low band busy the whole time, so the absolute figure sits
    // near a constant and nothing on screen appears to react.
    const relative = Math.max(0, Math.min(1, (now - this.mean) * 4 + 0.3));
    this.level += (relative - this.level) * Math.min(1, dt * 12);

    if (now > this.mean * 1.3 && now > 0.1 && this.sinceOnset > 0.15) {
      this.kick = 1;
      this.sinceOnset = 0;
    }
  }

  destroy(): void {
    try {
      this.source?.stop();
    } catch {
      // Source may never have started; nothing to stop.
    }
    this.source?.disconnect();
    void this.ctx.close();
  }
}
