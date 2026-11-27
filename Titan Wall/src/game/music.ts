/**
 * Procedural score: every wave gets its own generated theme (key, mode, tempo, arrangement) so no two
 * waves share a track. The palette follows the arcs of the anime's seasons:
 *   Season 1 — Wall Maria, the first Titans: low strings, slow and dread-filled   (waves 1–9)
 *   Season 2 — the breach: brass-like leads, driving percussion                   (waves 10–19)
 *   Season 3 — the beast Titan and the Reiss arc: heavy drums, darker modes        (waves 20–39)
 *   Season 4 — the Final Chapter: choral pads, long tension and release            (waves 40–59)
 *   Finale   — wave 60, the Founding Titan: everything at once
 * No audio files are used. Everything is synthesised with WebAudio, like the sound effects.
 */

export type Season = "maria" | "breach" | "beast" | "chapter" | "finale";

export interface TrackPlan {
  wave: number;
  season: Season;
  rootHz: number;
  mode: number[]; // scale degrees in semitones from the root
  bpm: number;
  /** 0 = calm pulse, 1 = full drums; the game raises this when Titans come close. */
  drumsAt: number;
  arp: number[]; // scale-degree indices for the arpeggio, one per 8th note (length 8)
  bass: number[]; // scale-degree indices for the bass, one per bar (length 4)
  tone: "dread" | "drive" | "dark" | "choir" | "epic" | "hope";
}

/** The ending theme: a slow major-pentatonic resolution in D, separate from every wave's score. */
export function endingPlan(): TrackPlan {
  return {
    wave: 61, // a value no wave uses, so the ending never counts as a repeat of a wave
    season: "finale",
    rootHz: 146.83,
    mode: MODES.hope,
    bpm: 72,
    drumsAt: 2, // never: the ending has no percussion
    arp: [0, 2, 4, 2, 3, 2, 1, 0],
    bass: [0, 3, 4, 0],
    tone: "hope",
  };
}

const MODES: Record<TrackPlan["tone"], number[]> = {
  dread: [0, 2, 3, 5, 7, 8, 10], // natural minor
  drive: [0, 2, 3, 5, 7, 9, 10], // dorian
  dark: [0, 1, 3, 5, 7, 8, 10], // phrygian
  choir: [0, 2, 4, 5, 7, 9, 11], // lydian-ish major
  epic: [0, 2, 4, 5, 7, 9, 10], // mixolydian
  hope: [0, 2, 4, 7, 9], // major pentatonic: the ending resolves rather than drives
};

/** Pure: the plan for wave `n`. Deterministic, so the same wave always sounds the same. */
export function trackPlan(n: number): TrackPlan {
  const wave = Math.max(1, Math.min(60, Math.floor(n)));
  const season: Season = wave === 60 ? "finale" : wave >= 40 ? "chapter" : wave >= 20 ? "beast" : wave >= 10 ? "breach" : "maria";
  const kind: TrackPlan["tone"] =
    season === "maria" ? "dread" : season === "breach" ? "drive" : season === "beast" ? "dark" : season === "chapter" ? "choir" : "epic";
  // a small seeded hash picks key, tempo and pattern so each wave differs from its neighbours
  let h = (wave * 2654435761) >>> 0;
  const rnd = () => {
    h = (Math.imul(h ^ (h >>> 15), 2246822519) + 0x9e3779b9) >>> 0;
    return (h % 10000) / 10000;
  };
  const roots = [146.83, 164.81, 130.81, 110, 123.47, 174.61, 98]; // D3 E3 C3 A2 B2 F3 G2
  const rootHz = roots[Math.floor(rnd() * roots.length)];
  const base = season === "maria" ? 84 : season === "breach" ? 112 : season === "beast" ? 96 : season === "chapter" ? 88 : 128;
  const bpm = base + Math.round(rnd() * 16);
  const arpPool = [
    [0, 2, 4, 2, 0, 2, 4, 6],
    [0, 4, 2, 6, 0, 4, 2, 6],
    [0, 0, 2, 4, 4, 2, 0, 2],
    [0, 2, 0, 4, 0, 2, 6, 4],
  ];
  const bassPool = [
    [0, 0, 3, 4],
    [0, 3, 4, 3],
    [0, 5, 3, 4],
    [0, 0, 5, 6],
  ];
  return {
    wave,
    season,
    rootHz,
    mode: MODES[kind],
    bpm,
    drumsAt: season === "maria" ? 0.6 : 0.3,
    arp: arpPool[Math.floor(rnd() * arpPool.length)],
    bass: bassPool[Math.floor(rnd() * bassPool.length)],
    tone: kind,
  };
}

const freq = (plan: TrackPlan, degree: number, octave: number) => {
  const oct = Math.floor(degree / plan.mode.length);
  const semis = plan.mode[degree % plan.mode.length] + 12 * (oct + octave);
  return plan.rootHz * Math.pow(2, semis / 12);
};

/** Schedules the current wave's theme on a lookahead timer. */
export class Music {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private timer: number | null = null;
  private plan: TrackPlan | null = null;
  private step = 0;
  private nextT = 0;
  private intensity = 0;

  /** Attach to the sound-effect context. Music is a child of the same output, so one mute covers both. */
  attach(ctx: AudioContext, master: AudioNode) {
    if (this.ctx === ctx) return;
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0.16;
    this.out.connect(master);
    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
  }

  /** Start the theme for wave `n`. Calling it again for the same wave is a no-op. */
  play(n: number) {
    this.playPlan(trackPlan(n));
  }

  /** The ending theme, after the campaign is won. */
  playEnding() {
    this.playPlan(endingPlan());
  }

  private playPlan(plan: TrackPlan) {
    if (!this.ctx) return;
    if (this.plan?.wave === plan.wave && this.timer !== null) return;
    this.plan = plan;
    this.step = 0;
    this.nextT = this.ctx.currentTime + 0.1;
    if (this.timer === null) this.timer = window.setInterval(() => this.pump(), 25);
  }

  stop() {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this.plan = null;
  }

  /** 0 = calm, 1 = Titans at the gate. Drums fade in above the plan's threshold. */
  setIntensity(x: number) {
    this.intensity = Math.max(0, Math.min(1, x));
  }

  /** Pause the score (the game is paused or on the death screen). */
  duck(on: boolean) {
    if (this.out && this.ctx) this.out.gain.setTargetAtTime(on ? 0.03 : 0.16, this.ctx.currentTime, 0.2);
  }

  private pump() {
    const c = this.ctx;
    const plan = this.plan;
    if (!c || !plan || !this.out) return;
    const stepDur = 60 / plan.bpm / 2; // 8th notes
    while (this.nextT < c.currentTime + 0.12) {
      this.scheduleStep(c, plan, this.step, this.nextT, stepDur);
      this.nextT += stepDur;
      this.step++;
    }
  }

  private scheduleStep(c: AudioContext, plan: TrackPlan, step: number, t: number, dur: number) {
    const s8 = step % 8;
    const bar = Math.floor(step / 8) % 4;
    // bass: one note per bar on the beat
    if (s8 === 0) {
      this.voice(c, t, dur * 7.5, freq(plan, plan.bass[bar], -1), "sawtooth", 0.5, 380);
    }
    // arpeggio: every 8th note, quieter in the calm sections
    const arpVol = plan.season === "maria" ? 0.05 : 0.08;
    this.voice(c, t, dur * 0.9, freq(plan, plan.arp[s8], 0), plan.season === "chapter" ? "sine" : "triangle", arpVol, 2400);
    // pad: a chord on each bar, slightly detuned
    if (s8 === 0) {
      const root = plan.bass[bar];
      for (const d of [root, root + 2, root + 4]) {
        this.voice(c, t, dur * 7.5, freq(plan, d, 0), "sawtooth", 0.035, 1200, 4);
      }
    }
    // drums: the kick on the beat; hats and snare follow the intensity
    const drums = this.intensity >= plan.drumsAt;
    if (s8 === 0 || (drums && (s8 === 4 || (plan.season === "breach" && s8 === 2)))) {
      this.kick(c, t, s8 === 0 ? 1 : 0.7);
    }
    if (drums && s8 % 2 === 1) this.hat(c, t, 0.05 + this.intensity * 0.06);
  }

  private voice(c: AudioContext, t: number, dur: number, f: number, type: OscillatorType, vol: number, cutoff: number, detune = 0) {
    if (!this.out) return;
    const o = c.createOscillator();
    const g = c.createGain();
    const lp = c.createBiquadFilter();
    o.type = type;
    o.frequency.value = f;
    o.detune.value = detune * (Math.random() * 6 - 3);
    lp.type = "lowpass";
    lp.frequency.value = cutoff;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(lp).connect(g).connect(this.out);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private kick(c: AudioContext, t: number, vol: number) {
    if (!this.out) return;
    const o = c.createOscillator();
    const g = c.createGain();
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    g.gain.setValueAtTime(vol * 0.9, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + 0.22);
  }

  private hat(c: AudioContext, t: number, vol: number) {
    if (!this.out || !this.noise) return;
    const s = c.createBufferSource();
    const hp = c.createBiquadFilter();
    const g = c.createGain();
    s.buffer = this.noise;
    hp.type = "highpass";
    hp.frequency.value = 7000;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    s.connect(hp).connect(g).connect(this.out);
    s.start(t, Math.random() * 0.3);
    s.stop(t + 0.06);
  }
}
