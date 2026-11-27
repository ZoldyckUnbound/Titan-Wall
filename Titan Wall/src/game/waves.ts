/**
 * The 60-wave campaign schedule. Pure data: no three.js, no game state, so it can be unit-tested.
 *
 * Story beats (lore-accurate ordering):
 *  - Waves 1–9: Pure and abnormal titans inside Wall Maria; the Garrison learns the nape weak point.
 *  - Wave 10: a colossal titan walks up to the Shiganshina gate and kicks Wall Maria open. Armored and
 *    normal titans pour through the breach (the colossal is the only one that breaks the wall).
 *  - Wave 15+: armored titans appear (their nape is shielded by plate and must be cut at speed).
 *  - Wave 20: beast titans only.
 *  - Wave 25: Rod Reiss plus abnormals.
 *  - Wave 60: the final wave. Clearing it completes the campaign.
 *
 * Heights are in game units (metres of the in-game scale, the same units as the wall height).
 */
export type SpawnKind = "normal" | "abnormal" | "armored" | "colossal" | "beast" | "reiss" | "hammer" | "founding";

export interface SpawnSpec {
  kind: SpawnKind;
  height: number;
  /** true = spawn just outside Wall Maria (only the wave-10 colossal and post-breach reinforcements). */
  outside: boolean;
}

export interface WaveSpec {
  n: number;
  title: string;
  spawns: SpawnSpec[];
  /** Wave-10 event: the colossal walks to the gate and kicks the wall. */
  colossalKick: boolean;
  /** Post-breach reinforcements spawn outside the wall and walk through the gap. */
  breachReinforce: SpawnSpec[];
}

export const FINAL_WAVE = 60;
export const KICK_WAVE = 10;
export const BEAST_WAVE = 20;
export const REISS_WAVE = 25;
export const ARMORED_FROM = 15;

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

export const KIND_HP: Record<SpawnKind, number> = {
  normal: 100,
  abnormal: 120,
  armored: 240,
  colossal: 700,
  beast: 320,
  reiss: 520,
  hammer: 650,
  founding: 1500,
};

/** Build the spawn list for wave `n` (1..60). Randomised heights, deterministic counts. */
export function waveSpec(n: number): WaveSpec {
  const wave = Math.max(1, Math.min(FINAL_WAVE, Math.floor(n)));
  const spawns: SpawnSpec[] = [];
  const breachReinforce: SpawnSpec[] = [];
  const add = (kind: SpawnKind, count: number, height: () => number, outside = false, into = spawns) => {
    for (let i = 0; i < count; i++) into.push({ kind, height: height(), outside });
  };
  const normalH = () => Math.min(15, rnd(8, 12) + wave * 0.05);

  if (wave === BEAST_WAVE) {
    // beast titans only
    add("beast", 3 + Math.floor(wave / 20), () => rnd(26, 30));
    return { n: wave, title: "Beast Titans", spawns, colossalKick: false, breachReinforce };
  }

  if (wave === KICK_WAVE) {
    add("colossal", 1, () => 48, true);
    add("normal", 3, normalH);
    add("abnormal", 1, () => rnd(10, 12));
    add("armored", 2, () => rnd(13, 15), true, breachReinforce);
    add("normal", 4, normalH, true, breachReinforce);
    return { n: wave, title: "Colossal Breach", spawns, colossalKick: true, breachReinforce };
  }

  if (wave === REISS_WAVE) {
    add("reiss", 1, () => 46);
    add("abnormal", 2 + Math.floor(wave / 25), () => rnd(10, 12));
    add("normal", 3, normalH);
    return { n: wave, title: "Rod Reiss", spawns, colossalKick: false, breachReinforce };
  }

  const normals = Math.min(2 + Math.floor(wave / 4), 8);
  const abnormals = wave >= 2 ? Math.min(Math.floor((wave - 1) / 5), 3) : 0;
  const armored = wave >= ARMORED_FROM ? Math.min(1 + Math.floor((wave - ARMORED_FROM) / 8), 3) : 0;
  add("normal", normals, normalH);
  add("abnormal", abnormals, () => rnd(10, 12));
  add("armored", armored, () => rnd(13, 15));
  if (wave === FINAL_WAVE) {
    // the last stand: the Founding Titan leads a war-hammer escort, with beasts and Reiss behind
    add("founding", 1, () => 60);
    add("hammer", 2, () => rnd(32, 36));
    add("beast", 2, () => rnd(26, 30));
    add("reiss", 1, () => 46);
  }
  const title = wave === FINAL_WAVE ? "The Founding Titan" : abnormals ? `${abnormals} Abnormal` : "Titans";
  return { n: wave, title, spawns, colossalKick: false, breachReinforce };
}

/** True once clearing `n` ends the campaign. */
export const isFinalWave = (n: number) => n >= FINAL_WAVE;
