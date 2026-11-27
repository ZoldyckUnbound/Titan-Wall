/**
 * Paradis Island — lore-scaled geography.
 *
 * Scale: 1 in-game metre ≈ 100 metres of the series (1 : 100 000 horizontally).
 * Wall radii follow the figures given on the Attack on Titan wiki:
 *   Wall Sina  ≈ 250 km  → 2 500 m
 *   Wall Rose  ≈ 380 km  → 3 800 m   (≈130 km outside Sina)
 *   Wall Maria ≈ 480 km  → 4 800 m   (≈100 km outside Rose)
 * All three walls are 50 m high (vertical scale is NOT compressed, so titans stay titans).
 *
 * Compass: north = −Z, south = +Z, east = +X, west = −X.
 * District positions are approximate placements that respect the published relations
 * (Shiganshina on Maria's southern edge, Trost on Rose's southern edge, Utopia north in Rose,
 * Mitras at the heart of Sina). Exact coordinates are not given in the series.
 */

export interface Vec2 {
  x: number;
  z: number;
}

export const WALL_H = 50;
export const WALL_T = 10;
export const SINA_R = 2500;
export const ROSE_R = 3800;
export const MARIA_R = 4800;
/** Playable outer limit (ocean beyond). */
export const MAP_R = 13500;
export const OCEAN_R = 14500;

export type DistrictKind = "capital" | "town" | "village" | "farm" | "ruin" | "outpost";

export interface District {
  id: string;
  name: string;
  kind: DistrictKind;
  wall: "sina" | "rose" | "maria" | "outside";
  c: Vec2;
  r: number;
  /** Number of buildings to scatter. */
  density: number;
  /** Architecture palette. */
  style: "stone" | "plaster" | "timber" | "farm";
  /** Has a plaza fountain at the centre. */
  fountain: boolean;
  /** Short description used in the tutorial / codex. */
  note: string;
}

export const DISTRICTS: District[] = [
  // ---- Wall Sina (innermost, 250 km in the series)
  { id: "mitras", name: "Mitras", kind: "capital", wall: "sina", c: { x: 0, z: 0 }, r: 900, density: 520, style: "stone", fountain: true, note: "Capital of the Royal Government. Palace, cathedral and the Royal Fountain sit at the centre." },
  { id: "stohess", name: "Stohess", kind: "town", wall: "sina", c: { x: -1550, z: -350 }, r: 430, density: 240, style: "plaster", fountain: true, note: "Stohess District, home of the Garrison's training grounds and Shiganshina's refugees." },
  { id: "orvud", name: "Orvud", kind: "town", wall: "sina", c: { x: 1450, z: -600 }, r: 380, density: 150, style: "plaster", fountain: true, note: "Orvud District, a merchant quarter inside Wall Sina." },
  { id: "ehrmich", name: "Ehrmich", kind: "village", wall: "sina", c: { x: -900, z: -1450 }, r: 360, density: 130, style: "timber", fountain: false, note: "Ehrmich District, quiet and wooded." },
  { id: "yarckel", name: "Yarckel", kind: "village", wall: "sina", c: { x: 1100, z: 1250 }, r: 380, density: 140, style: "timber", fountain: false, note: "Yarckel District, a farming and craft town." },
  // ---- Wall Rose (middle, 380 km in the series)
  { id: "trost", name: "Trost", kind: "town", wall: "rose", c: { x: 300, z: 3250 }, r: 420, density: 360, style: "timber", fountain: true, note: "Southernmost district of Wall Rose. Site of the Battle of Trost and the Trost Gate." },
  { id: "utopia", name: "Utopia", kind: "village", wall: "rose", c: { x: -200, z: -3200 }, r: 380, density: 120, style: "timber", fountain: false, note: "Northernmost district of Wall Rose, famed for its farms and bread." },
  { id: "karanes", name: "Karanes", kind: "village", wall: "rose", c: { x: 3200, z: 300 }, r: 330, density: 110, style: "stone", fountain: false, note: "Eastern district of Wall Rose." },
  { id: "krolva", name: "Krolva", kind: "village", wall: "rose", c: { x: -3050, z: -400 }, r: 320, density: 110, style: "plaster", fountain: false, note: "Western district of Wall Rose." },
  { id: "jinae", name: "Jinae", kind: "village", wall: "rose", c: { x: -1700, z: 2650 }, r: 300, density: 90, style: "timber", fountain: false, note: "Southern town of Wall Rose, home of Marco Bodt." },
  { id: "utgard", name: "Utgard Castle", kind: "ruin", wall: "rose", c: { x: 2350, z: -2050 }, r: 170, density: 26, style: "stone", fountain: false, note: "Abandoned castle near the inner side of Wall Rose, stocked with old provisions." },
  // ---- Wall Maria (outermost, 480 km in the series)
  { id: "shiganshina", name: "Shiganshina", kind: "town", wall: "maria", c: { x: 0, z: 4300 }, r: 400, density: 200, style: "timber", fountain: true, note: "Southern edge of Wall Maria. Eren, Mikasa and Armin's hometown. The Shiganshina Gate was breached by the Colossal Titan." },
];

/** Shiganshina gate — the Wall Maria section that the Colossal Titan will kick open at wave 10. */
export const SHIG_GATE = { x: 0, z: MARIA_R };
export const SHIG_GATE_HALF = 18;

export interface Forest {
  c: Vec2;
  r: number;
  trees: number;
  inside: boolean;
}
/** Forests of Giant Trees (≈80 m trunks). Titans cannot climb them. */
export const FORESTS: Forest[] = [
  { c: { x: 3300, z: 2950 }, r: 560, trees: 90, inside: true },
  { c: { x: -3700, z: -2600 }, r: 470, trees: 70, inside: true },
  { c: { x: 3900, z: -2300 }, r: 380, trees: 55, inside: true },
  { c: { x: -6200, z: 5400 }, r: 1500, trees: 240, inside: false },
  { c: { x: 7400, z: -3800 }, r: 1250, trees: 200, inside: false },
  { c: { x: 1500, z: 9800 }, r: 1600, trees: 260, inside: false },
  { c: { x: -9000, z: -5600 }, r: 1700, trees: 260, inside: false },
];

/** Survey Corps supply depots — the only places to refill gas, blades, thunder spears and health. */
export const DEPOTS: { id: string; name: string; c: Vec2 }[] = [
  { id: "sh-square", name: "Shiganshina Square Depot", c: { x: 0, z: 4215 } },
  { id: "sh-gate-w", name: "Gate Post West", c: { x: -820, z: 4480 } },
  { id: "sh-gate-e", name: "Gate Post East", c: { x: 820, z: 4480 } },
  { id: "farm-sw", name: "Farmland Depot", c: { x: -2300, z: 3150 } },
  { id: "forest-se", name: "Forest Camp", c: { x: 3300, z: 2550 } },
  { id: "north-relay", name: "North Relay", c: { x: 2000, z: -1500 } },
];

/** Shiganshina ground zero: the player's starting square. */
export const PLAYER_START = { x: 0, z: 4150 };

/** Wall-climb / colossal / reiss spawn zones are chosen from these outside angles. */
export const OUTSIDE_ARC = { from: Math.PI * 0.35, to: Math.PI * 0.65 }; // south arc (atan2(z,x) convention)

export const RINGS = [
  { id: "sina", r: SINA_R, name: "Wall Sina", color: 0xc9c2b2 },
  { id: "rose", r: ROSE_R, name: "Wall Rose", color: 0xbdb5a5 },
  { id: "maria", r: MARIA_R, name: "Wall Maria", color: 0xb7afa0 },
] as const;

export function wallRingAt(x: number, z: number): "sina" | "rose" | "maria" | "outside" {
  const d = Math.hypot(x, z);
  if (d > MARIA_R) return "outside";
  if (d > ROSE_R) return "maria";
  if (d > SINA_R) return "rose";
  return "sina";
}

/** Distance from a point to the centre-line of a wall ring. */
export function distToRing(x: number, z: number, r: number) {
  return Math.abs(Math.hypot(x, z) - r);
}
