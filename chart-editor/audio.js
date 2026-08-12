// AudioEngine: decode, transport (play/pause/seek/rate), song-time clock,
// and a lookahead scheduler for metronome ticks + note hitsounds.

export class AudioEngine {
  constructor() {
    this.ctx = new AudioContext();
    this.buffer = null;
    this.mono = null;          // Float32Array mixdown for waveform/analysis
    this.fileName = "";
    this.duration = 0;

    this.source = null;
    this.playing = false;
    this.rate = 1.0;
    this.songPos = 0;          // position when paused / at last play()
    this.startCtxTime = 0;

    this.gain = this.ctx.createGain();
    this.gain.connect(this.ctx.destination);
    this.fxGain = this.ctx.createGain();
    this.fxGain.gain.value = 0.5;
    this.fxGain.connect(this.ctx.destination);

    this.metronomeOn = false;
    this.hitsoundsOn = false;
    // Providers wired by main.js
    this.getBpm = () => 120;
    this.getOffset = () => 0;
    this.getNotes = () => [];
    this.onSongEnd = () => {};

    this._schedTimer = null;
    this._schedUntil = 0;      // song time scheduled so far
  }

  async load(file) {
    this.stop();
    const buf = await file.arrayBuffer();
    this.buffer = await this.ctx.decodeAudioData(buf);
    this.fileName = file.name;
    this.duration = this.buffer.duration;
    this.songPos = 0;
    // Mono mixdown
    const len = this.buffer.length;
    this.mono = new Float32Array(len);
    for (let c = 0; c < this.buffer.numberOfChannels; c++) {
      const data = this.buffer.getChannelData(c);
      for (let i = 0; i < len; i++) this.mono[i] += data[i];
    }
    if (this.buffer.numberOfChannels > 1) {
      const inv = 1 / this.buffer.numberOfChannels;
      for (let i = 0; i < len; i++) this.mono[i] *= inv;
    }
  }

  get time() {
    if (!this.playing) return this.songPos;
    const t = this.songPos + (this.ctx.currentTime - this.startCtxTime) * this.rate;
    return Math.min(t, this.duration);
  }

  play() {
    if (!this.buffer || this.playing) return;
    if (this.ctx.state === "suspended") this.ctx.resume();
    if (this.songPos >= this.duration - 0.01) this.songPos = 0;
    this.source = this.ctx.createBufferSource();
    this.source.buffer = this.buffer;
    this.source.playbackRate.value = this.rate;
    this.source.connect(this.gain);
    const src = this.source;
    this.source.onended = () => {
      if (this.source === src && this.playing) {
        this._setPaused(this.duration);
        this.onSongEnd();
      }
    };
    this.startCtxTime = this.ctx.currentTime;
    this.source.start(0, this.songPos);
    this.playing = true;
    this._startScheduler();
  }

  pause() {
    if (!this.playing) return;
    this._setPaused(this.time);
  }

  _setPaused(pos) {
    this.songPos = Math.max(0, Math.min(pos, this.duration));
    this.playing = false;
    if (this.source) {
      this.source.onended = null;
      try { this.source.stop(); } catch {}
      this.source = null;
    }
    this._stopScheduler();
  }

  stop() { this._setPaused(0); }

  toggle() { this.playing ? this.pause() : this.play(); }

  seek(t) {
    const wasPlaying = this.playing;
    this._setPaused(t);
    if (wasPlaying) this.play();
  }

  setRate(r) {
    const wasPlaying = this.playing;
    if (wasPlaying) this.pause();
    this.rate = r;
    if (wasPlaying) this.play();
  }

  // Audible scrub grain while paused
  scrubTick(t) {
    if (!this.buffer || this.playing) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.connect(this.gain);
    src.start(0, Math.max(0, t), 0.06);
  }

  // --- Lookahead scheduler ("tale of two clocks") ---
  _startScheduler() {
    this._schedUntil = this.time;
    this._schedTimer = setInterval(() => this._scheduleWindow(), 25);
    this._scheduleWindow();
  }

  _stopScheduler() {
    if (this._schedTimer) { clearInterval(this._schedTimer); this._schedTimer = null; }
  }

  _scheduleWindow() {
    if (!this.playing) return;
    const now = this.time;
    const horizon = now + 0.12 * this.rate; // 120 ms of wall time ahead
    const from = Math.max(this._schedUntil, now);
    if (horizon <= from) return;

    if (this.metronomeOn) {
      const bpm = this.getBpm(), offset = this.getOffset();
      if (bpm > 0) {
        const beatSec = 60 / bpm;
        let k = Math.ceil((from - offset) / beatSec - 1e-6);
        for (; offset + k * beatSec < horizon; k++) {
          const t = offset + k * beatSec;
          if (t < from) continue;
          this._blip(this._songTimeToCtxTime(t), k % 4 === 0 ? 1000 : 800, 0.03);
        }
      }
    }
    if (this.hitsoundsOn) {
      for (const n of this.getNotes()) {
        if (n.t >= from && n.t < horizon) this._blip(this._songTimeToCtxTime(n.t), 2000, 0.025);
      }
    }
    this._schedUntil = horizon;
  }

  _songTimeToCtxTime(t) {
    return this.startCtxTime + (t - this.songPos) / this.rate;
  }

  _blip(when, freq, dur) {
    if (when < this.ctx.currentTime) when = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.frequency.value = freq;
    osc.connect(g);
    g.connect(this.fxGain);
    g.gain.setValueAtTime(0.6, when);
    g.gain.exponentialRampToValueAtTime(0.001, when + dur);
    osc.start(when);
    osc.stop(when + dur + 0.01);
  }

  // Immediate blip (UI feedback, tap-tempo)
  clickNow(freq = 1200) {
    if (this.ctx.state === "suspended") this.ctx.resume();
    this._blip(this.ctx.currentTime, freq, 0.03);
  }
}
