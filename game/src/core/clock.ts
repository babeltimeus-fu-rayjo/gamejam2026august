/**
 * AudioClock — the game's single source of time.
 *
 * All gameplay timing derives from AudioContext.currentTime (the hardware
 * audio clock). Frame timers drift against audio playback, so note
 * positions and judgements must never accumulate ticker deltas; they read
 * songTime() fresh instead. See PLAN.md §1.
 *
 * Browsers create AudioContexts in a "suspended" state outside user
 * gestures; callers should invoke resume() from input handlers until
 * `running` is true before start()ing playback.
 */
export class AudioClock {
  private readonly ctx = new AudioContext();
  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  /** ctx.currentTime at which song t=0 falls; null until start(). */
  private startAt: number | null = null;

  /** True once the context is unlocked and its clock is advancing. */
  get running(): boolean {
    return this.ctx.state === "running";
  }

  get loaded(): boolean {
    return this.buffer !== null;
  }

  get started(): boolean {
    return this.startAt !== null;
  }

  /** Try to unlock the context. Safe to call repeatedly from key handlers. */
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

  /**
   * Freeze playback in place. Suspending the context halts
   * AudioContext.currentTime itself, so songTime() freezes with the audio
   * and resume() continues from the exact same position.
   */
  async pause(): Promise<void> {
    if (this.ctx.state === "running") {
      try {
        await this.ctx.suspend();
      } catch {
        // Context is closing; nothing to freeze.
      }
    }
  }

  /** Fetch and decode the song. Decoding works even while suspended. */
  async load(url: string): Promise<void> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`audio fetch failed: ${res.status} ${url}`);
    const bytes = await res.arrayBuffer();
    this.buffer = await this.ctx.decodeAudioData(bytes);
  }

  /**
   * Schedule playback so song t=0 lands `leadIn` seconds ahead on the
   * hardware clock. songTime() runs negative during the lead-in, which the
   * position formula handles naturally (notes are just further left).
   */
  start(leadIn = 1): void {
    if (!this.buffer || this.startAt !== null) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.connect(this.ctx.destination);
    this.startAt = this.ctx.currentTime + leadIn;
    src.start(this.startAt);
    this.source = src;
  }

  /** Seconds into the song (negative during lead-in; 0 before start). */
  songTime(): number {
    return this.startAt === null ? 0 : this.ctx.currentTime - this.startAt;
  }

  /**
   * Schedule a short beep at an exact song time. M1 uses this as a
   * metronome on note times to make clock/visual alignment audible.
   */
  clickAt(songTime: number, freq = 880): void {
    if (this.startAt === null) return;
    const at = this.startAt + songTime;
    if (at <= this.ctx.currentTime) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "square";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.15, at + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(at);
    osc.stop(at + 0.06);
  }

  /** Stop playback and release the audio device (call on scene exit). */
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
