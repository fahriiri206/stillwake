// Tiny synthesised score for Stillwake. No files, samples, network or autoplay: the context is
// created on the first user gesture, then buoys pluck, lanterns chime, reefs thud and the
// harbor answers with a five-note cadence.

export class Sound {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
  }

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.28;
    this.master.connect(this.ctx.destination);
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master && this.ctx) {
      this.master.gain.cancelScheduledValues(this.ctx.currentTime);
      this.master.gain.setTargetAtTime(muted ? 0 : 0.28, this.ctx.currentTime, 0.03);
    }
  }

  tone(freq, at, dur, gain = 0.2, type = 'sine', bend = 0) {
    if (!this.ctx || !this.master || this.muted) return;
    const t0 = this.ctx.currentTime + at;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (bend) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq * bend), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + Math.min(0.03, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  noise(at, dur, gain = 0.12) {
    if (!this.ctx || !this.master || this.muted) return;
    const t0 = this.ctx.currentTime + at;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = last * 0.72 + white * 0.28;
      data[i] = last * (1 - i / len);
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 620;
    src.connect(filter).connect(g).connect(this.master);
    src.start(t0);
  }

  pluck() {
    this.unlock();
    this.tone(523.25, 0, 0.16, 0.14, 'triangle');
    this.tone(783.99, 0.015, 0.11, 0.07, 'sine');
  }

  place() {
    this.unlock();
    this.tone(392, 0, 0.14, 0.12, 'triangle', 1.25);
    this.tone(587.33, 0.05, 0.12, 0.05, 'sine');
  }

  pickup() {
    this.unlock();
    this.tone(659.25, 0, 0.2, 0.12, 'sine');
    this.tone(987.77, 0.07, 0.26, 0.1, 'sine');
    this.tone(1318.5, 0.14, 0.18, 0.045, 'triangle');
  }

  fail() {
    this.unlock();
    this.noise(0, 0.3, 0.2);
    this.tone(164.81, 0, 0.42, 0.14, 'sawtooth', 0.55);
    this.tone(123.47, 0.06, 0.38, 0.1, 'sine', 0.72);
  }

  win() {
    this.unlock();
    const notes = [523.25, 659.25, 783.99, 987.77, 1174.66];
    notes.forEach((n, i) => {
      this.tone(n, i * 0.1, 0.42, 0.1, i === 4 ? 'triangle' : 'sine');
      this.tone(n * 0.5, i * 0.1, 0.5, 0.035, 'sine');
    });
    this.tone(1567.98, 0.6, 0.7, 0.05, 'sine');
  }

  click() {
    this.unlock();
    this.tone(440, 0, 0.05, 0.04, 'sine');
  }

  turn() {
    this.unlock();
    this.tone(330, 0, 0.08, 0.045, 'triangle', 1.12);
  }
}
