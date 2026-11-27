/**
 * Day and night. Pure maths (no three.js rendering) so it can be unit-tested.
 *
 * The clock is a fraction of a day `t` in [0, 1):  t = 0 is sunrise (06:00), t = 0.25 noon,
 * t = 0.5 sunset (18:00), t = 0.75 midnight. One in-game day lasts DAY_SEC of play time.
 */
export const DAY_SEC = 600; // 10 minutes of play per in-game day
export const START_HOUR = 8; // a run begins in the morning

export interface SkyLight {
  /** Sun elevation in [-1, 1] (sin of the angle above the horizon). */
  elevation: number;
  /** Compass-like azimuth of the sun, radians (east to west across the day). */
  azimuth: number;
  /** 0 at deep night, 1 in full daylight. */
  daylight: number;
  /** 0..1, peaks around sunrise and sunset. */
  dusk: number;
  sunIntensity: number;
  hemiIntensity: number;
  sunColor: [number, number, number];
  hemiSky: [number, number, number];
  skyTop: [number, number, number];
  skyHorizon: [number, number, number];
}

export const hourOf = (t: number) => (t * 24 + 6) % 24;

export function clockLabel(t: number): string {
  const h = hourOf(t);
  const hh = Math.floor(h);
  const mm = Math.floor((h - hh) * 60);
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/** Time-of-day name for the HUD. */
export function periodName(t: number): string {
  const h = hourOf(t);
  if (h < 5.5 || h >= 20) return "Night";
  if (h < 8) return "Dawn";
  if (h < 16.5) return "Day";
  return "Dusk";
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const mix3 = (a: [number, number, number], b: [number, number, number], k: number): [number, number, number] => [
  lerp(a[0], b[0], k),
  lerp(a[1], b[1], k),
  lerp(a[2], b[2], k),
];

const NIGHT_SKY_TOP: [number, number, number] = [0.02, 0.04, 0.1];
const NIGHT_SKY_HOR: [number, number, number] = [0.1, 0.13, 0.2];
const DAY_SKY_TOP: [number, number, number] = [0.24, 0.47, 0.78];
const DAY_SKY_HOR: [number, number, number] = [0.82, 0.87, 0.92];
const DUSK_HOR: [number, number, number] = [0.95, 0.56, 0.32];
const DAY_SUN: [number, number, number] = [1.0, 0.94, 0.84];
const DUSK_SUN: [number, number, number] = [1.0, 0.6, 0.35];
const MOON_SUN: [number, number, number] = [0.45, 0.55, 0.85];
const NIGHT_HEMI: [number, number, number] = [0.14, 0.2, 0.38];
const DAY_HEMI: [number, number, number] = [0.86, 0.91, 1.0];

/** Sun, moon and sky state for the clock value `t`. */
export function skyLight(t: number): SkyLight {
  const a = 2 * Math.PI * t;
  const elevation = Math.sin(a);
  const daylight = clamp01((elevation + 0.12) / 0.3);
  // dusk: warm light near the horizon on both sides of the sun
  const dusk = clamp01(1 - Math.abs(elevation) / 0.28) * (elevation > -0.2 ? 1 : 0);
  const warmHorizon = dusk * 0.85;

  const sunColor = mix3(MOON_SUN, mix3(DAY_SUN, DUSK_SUN, dusk), daylight);
  const hemiSky = mix3(NIGHT_HEMI, DAY_HEMI, daylight);
  const skyTop = mix3(NIGHT_SKY_TOP, DAY_SKY_TOP, daylight);
  const skyHorizon = mix3(mix3(NIGHT_SKY_HOR, DAY_SKY_HOR, daylight), DUSK_HOR, warmHorizon);

  return {
    elevation,
    azimuth: a,
    daylight,
    dusk,
    sunIntensity: lerp(0.45, 2.6, daylight),
    hemiIntensity: lerp(0.4, 1.05, daylight),
    sunColor,
    hemiSky,
    skyTop,
    skyHorizon,
  };
}
