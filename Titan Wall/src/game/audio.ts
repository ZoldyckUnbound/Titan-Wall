/** Tiny procedural WebAudio layer — no audio files needed. */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private gasGain: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  muted = false;
  /** Called once the audio graph exists (the music layer attaches to it). */
  onReady: ((ctx: AudioContext, out: GainNode) => void) | null = null;

  init() {
    if (typeof window === "undefined") return;
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AC();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = 0.55;
      this.master.connect(ctx.destination);
      const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this.noise = buf;
      // continuous gas-jet hiss (gain follows boost state)
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 2200;
      bp.Q.value = 0.7;
      this.gasGain = ctx.createGain();
      this.gasGain.gain.value = 0;
      src.connect(bp).connect(this.gasGain).connect(this.master);
      src.start();
      this.onReady?.(ctx, this.master);
    } catch {
      this.ctx = null;
    }
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.55;
    return this.muted;
  }

  setGas(on: boolean) {
    if (!this.ctx || !this.gasGain) return;
    this.gasGain.gain.setTargetAtTime(on && !this.muted ? 0.28 : 0, this.ctx.currentTime, 0.05);
  }

  private tone(f0: number, f1: number, dur: number, vol: number, type: OscillatorType = "sine") {
    const c = this.ctx;
    if (!c || !this.master || this.muted) return;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, c.currentTime);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), c.currentTime + dur);
    g.gain.setValueAtTime(vol, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
    o.connect(g).connect(this.master);
    o.start();
    o.stop(c.currentTime + dur + 0.02);
  }

  private hiss(dur: number, vol: number, f0: number, f1: number, type: BiquadFilterType = "bandpass") {
    const c = this.ctx;
    if (!c || !this.master || !this.noise || this.muted) return;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(f0, c.currentTime);
    f.frequency.exponentialRampToValueAtTime(f1, c.currentTime + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(0, Math.random());
    s.stop(c.currentTime + dur + 0.02);
  }

  hook() {
    this.hiss(0.12, 0.25, 4000, 1500, "highpass");
    this.tone(1100, 500, 0.1, 0.12, "square");
  }
  hookHit() {
    this.tone(180, 60, 0.12, 0.35);
    this.hiss(0.06, 0.2, 3000, 800);
  }
  slash() {
    this.hiss(0.2, 0.4, 1500, 7000);
  }
  clang() {
    this.tone(1800, 900, 0.12, 0.18, "triangle");
    this.hiss(0.08, 0.25, 6000, 3000, "highpass");
  }
  kill() {
    this.tone(95, 28, 0.7, 0.6);
    this.hiss(1.1, 0.35, 5000, 700, "lowpass");
    this.tone(1400, 2200, 0.15, 0.15, "triangle");
  }
  thud(vol: number) {
    if (vol < 0.02) return;
    this.tone(70, 32, 0.28, Math.min(0.5, vol));
  }
  grab() {
    this.tone(420, 190, 0.5, 0.3, "sawtooth");
    this.tone(450, 200, 0.5, 0.2, "sawtooth");
  }
  hurt() {
    this.hiss(0.18, 0.4, 600, 150, "lowpass");
    this.tone(140, 50, 0.2, 0.3);
  }
}
