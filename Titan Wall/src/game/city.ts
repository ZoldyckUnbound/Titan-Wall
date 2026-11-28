import { RNG } from "./math";
import { DISTRICTS, DEPOTS, FORESTS, MARIA_R, ROSE_R, SINA_R, SHIG_GATE, SHIG_GATE_HALF, MAP_R } from "./lore";
import type { District } from "./lore";
import type { BuildingSpec, RoofKind, Shape, Style } from "./buildings";

export interface TreeSpec {
  x: number;
  z: number;
  h: number;
  r: number;
}
export interface GatehouseSpec {
  ring: "sina" | "rose" | "maria";
  x: number;
  z: number;
  yaw: number;
  w: number;
  d: number;
  h: number;
}
export interface Layout {
  buildings: BuildingSpec[];
  gatehouses: GatehouseSpec[];
  trees: TreeSpec[];
  fountains: { x: number; z: number; r: number; district: string }[];
  depotSites: { id: string; x: number; z: number }[];
  forestCount: number;
}

const WALL_MARGIN = 26; // keep buildings clear of the wall line
const ROAD_HALF = 4.6; // half road width for main streets
const DEPOT_R = 16;

/** Simple spatial hash of axis-aligned footprints for overlap tests. */
class Occupancy {
  private cells = new Map<number, { x0: number; x1: number; z0: number; z1: number }[]>();
  add(x0: number, x1: number, z0: number, z1: number) {
    for (let x = Math.floor(x0 / 40); x <= Math.floor(x1 / 40); x++)
      for (let z = Math.floor(z0 / 40); z <= Math.floor(z1 / 40); z++) {
        const k = x * 100003 + z;
        let a = this.cells.get(k);
        if (!a) this.cells.set(k, (a = []));
        a.push({ x0, x1, z0, z1 });
      }
  }
  hits(x0: number, x1: number, z0: number, z1: number) {
    for (let x = Math.floor(x0 / 40); x <= Math.floor(x1 / 40); x++)
      for (let z = Math.floor(z0 / 40); z <= Math.floor(z1 / 40); z++) {
        const a = this.cells.get(x * 100003 + z);
        if (!a) continue;
        for (const r of a) if (x0 < r.x1 && x1 > r.x0 && z0 < r.z1 && z1 > r.z0) return true;
      }
    return false;
  }
}

const ringBlocked = (x: number, z: number) => {
  const d = Math.hypot(x, z);
  return Math.abs(d - SINA_R) < WALL_MARGIN || Math.abs(d - ROSE_R) < WALL_MARGIN || Math.abs(d - MARIA_R) < WALL_MARGIN + 6;
};

const inForest = (x: number, z: number) => FORESTS.some((f) => Math.hypot(x - f.c.x, z - f.c.z) < f.r + 12);
const nearDepot = (x: number, z: number) => DEPOTS.some((d) => Math.hypot(x - d.c.x, z - d.c.z) < DEPOT_R + 6);
const inBreach = (x: number, z: number) => Math.hypot(x - SHIG_GATE.x, z - SHIG_GATE.z) < SHIG_GATE_HALF + 28;

const PALETTE: Record<Style, { walls: number[]; roofs: number[] }> = {
  plaster: { walls: [0xf1e9d5, 0xe8dbc0, 0xdccba9, 0xf4eee0, 0xd6c6a6], roofs: [0x8a4b35, 0x7a3b2b, 0x6e4a3a, 0x9a5a3a] },
  timber: { walls: [0xd7c19c, 0xc7ac86, 0xb89a72, 0xe0cfb0], roofs: [0x6b4a36, 0x5a4636, 0x7a5a3a, 0x8e7b4f] },
  stone: { walls: [0xb8b2a4, 0xa9a396, 0xc2baa8, 0xd0c8b5], roofs: [0x4b4f57, 0x5a5f66, 0x6a5a4a] },
  farm: { walls: [0xc9b592, 0xb7a078, 0xd8ccb0, 0xa8926a], roofs: [0x6f4c36, 0x8c5a3c, 0x5e5a4e, 0x9c8a5a] },
  palace: { walls: [0xe9e3d0], roofs: [0x5a6470] },
  church: { walls: [0xe2dccb, 0xd8d0bc], roofs: [0x4a4f57] },
  gatehouse: { walls: [0xa9a396, 0xb8b2a4], roofs: [0x5a5f66] },
  ruin: { walls: [0x8e887c, 0x9a9283], roofs: [0x5a4a3a] },
};

export function generateLayout(seed = 1337): Layout {
  const rng = new RNG(seed);
  const occ = new Occupancy();
  const out: BuildingSpec[] = [];
  const gatehouses: GatehouseSpec[] = [];
  const trees: TreeSpec[] = [];
  const fountains: Layout["fountains"] = [];
  let id = 1;

  const mk = (p: {
    district: string;
    shape: Shape;
    style: Style;
    roof: RoofKind;
    x: number;
    z: number;
    yaw: number;
    w: number;
    d: number;
    floors: number;
    destructible?: boolean;
    hp?: number;
    chimney?: boolean;
  }): BuildingSpec => {
    const pal = PALETTE[p.style];
    const wallH = p.shape === "church" ? 9 : p.shape === "palace" ? 22 : p.shape === "ruin" ? 4 : p.floors * 3.2 + 0.5;
    const roofH = p.roof === "gable" || p.roof === "thatch" || p.roof === "hip" ? Math.min(p.w, p.d) * 0.5 : 0;
    const spec: BuildingSpec = {
      id: id++,
      district: p.district,
      shape: p.shape,
      style: p.style,
      roof: p.roof,
      x: p.x,
      z: p.z,
      yaw: p.yaw,
      w: p.w,
      d: p.d,
      floors: p.floors,
      wallH,
      wallCol: pal.walls[Math.floor(rng.next() * pal.walls.length)],
      roofCol: pal.roofs[Math.floor(rng.next() * pal.roofs.length)],
      chimney: p.chimney ?? rng.next() < 0.55,
      hp: p.hp ?? Math.round(p.w * p.d * p.floors * 0.9),
      maxHp: 0,
      destructible: p.destructible ?? true,
      alive: true,
      seed: Math.floor(rng.next() * 1e9),
      top: wallH + roofH + (p.shape === "church" ? 16 : p.shape === "palace" ? 15 : 0),
    };
    spec.maxHp = spec.hp;
    const c = Math.abs(Math.cos(p.yaw));
    const s = Math.abs(Math.sin(p.yaw));
    const hx = (p.w * c + p.d * s) / 2;
    const hz = (p.w * s + p.d * c) / 2;
    occ.add(p.x - hx, p.x + hx, p.z - hz, p.z + hz);
    out.push(spec);
    return spec;
  };

  const footprintFits = (x: number, z: number, w: number, d: number, yaw: number) => {
    const c = Math.abs(Math.cos(yaw));
    const s = Math.abs(Math.sin(yaw));
    const hx = (w * c + d * s) / 2;
    const hz = (w * s + d * c) / 2;
    if (Math.hypot(x, z) + Math.max(hx, hz) > MAP_R - 10) return false;
    // wall bands
    for (const [dx, dz] of [
      [hx, hz],
      [-hx, hz],
      [hx, -hz],
      [-hx, -hz],
      [0, 0],
    ]) {
      if (ringBlocked(x + dx, z + dz)) return false;
    }
    if (inBreach(x, z)) return false;
    if (nearDepot(x, z)) return false;
    if (inForest(x, z)) return false;
    return !occ.hits(x - hx, x + hx, z - hz, z + hz);
  };

  // ---------------- wall gatehouses at the four cardinal points of each ring
  for (const [ring, R, w] of [
    ["sina", SINA_R, 26],
    ["rose", ROSE_R, 30],
    ["maria", MARIA_R, 34],
  ] as const) {
    for (const ang of [-Math.PI / 2, 0, Math.PI / 2, Math.PI]) {
      const x = Math.cos(ang) * R;
      const z = Math.sin(ang) * R;
      const yaw = Math.atan2(Math.cos(ang), Math.sin(ang));
      gatehouses.push({ ring, x, z, yaw, w, d: 16, h: 50 });
      // the gate tower is a wall structure: indestructible, but it is also an occupied footprint
      occ.add(x - w, x + w, z - w, z + w);
    }
  }

  // ---------------- districts
  const plazaClear = (d: District) => d.r * 0.14;
  for (const d of DISTRICTS) {
    const style: Style = d.style;
    const isCapital = d.kind === "capital";
    const fx = d.c.x;
    const fz = d.c.z;
    if (d.fountain) {
      const fr = isCapital ? 14 : 8;
      fountains.push({ x: fx, z: fz, r: fr, district: d.id });
      occ.add(fx - fr - 3, fx + fr + 3, fz - fr - 3, fz + fr + 3);
    }
    if (isCapital) {
      // Royal Palace at the heart of Mitras, with a forecourt fountain beyond it
      mk({ district: d.id, shape: "palace", style: "palace", roof: "hip", x: fx, z: fz - 40, yaw: 0, w: 120, d: 84, floors: 5, destructible: false, hp: 99999, chimney: false });
      fountains.push({ x: fx, z: fz + 58, r: 12, district: d.id });
      occ.add(fx - 16, fx + 16, fz + 42, fz + 74);
      // cathedral
      mk({ district: d.id, shape: "church", style: "church", roof: "gable", x: fx - 210, z: fz - 150, yaw: 0.2, w: 24, d: 46, floors: 3, destructible: false, hp: 99999, chimney: false });
      mk({ district: d.id, shape: "church", style: "church", roof: "gable", x: fx + 230, z: fz + 180, yaw: -0.4, w: 20, d: 38, floors: 3, destructible: false, hp: 99999, chimney: false });
    } else if (d.kind === "town" || d.kind === "village") {
      // a parish church beside the square
      const cw = d.kind === "town" ? 14 : 11;
      mk({ district: d.id, shape: "church", style: style === "stone" ? "stone" : "plaster", roof: "gable", x: fx + d.r * 0.42, z: fz - d.r * 0.42, yaw: rng.range(-0.3, 0.3), w: cw, d: cw * 2, floors: 2, destructible: false, hp: 99999, chimney: false });
    }
    if (d.kind === "ruin") {
      for (let i = 0; i < 4; i++) {
        const ang = (i / 4) * Math.PI * 2;
        mk({ district: d.id, shape: "tower", style: "ruin", roof: "none", x: fx + Math.cos(ang) * 60, z: fz + Math.sin(ang) * 60, yaw: ang, w: 14, d: 8, floors: 3, destructible: false, hp: 99999, chimney: false });
      }
    }

    // village gates: a timber gate pair on each road axis at the edge of the district (towns and villages only)
    if (d.kind === "town" || d.kind === "village") {
      const gx = d.r * 0.92;
      for (const [ox, oz] of [[gx, 0], [-gx, 0], [0, gx], [0, -gx]]) {
        const across = ox !== 0 ? [0, 1] : [1, 0];
        for (const sgn of [-1, 1]) {
          const px = fx + ox + across[0] * sgn * (ROAD_HALF + 2.2);
          const pz = fz + oz + across[1] * sgn * (ROAD_HALF + 2.2);
          mk({ district: d.id, shape: "tower", style: "timber", roof: "gable", x: px, z: pz, yaw: 0, w: 2.6, d: 2.6, floors: 4, destructible: false, hp: 99999, chimney: false });
          occ.add(px - 2, px + 2, pz - 2, pz + 2);
        }
      }
    }

    // scatter the rest. Villages get about a third more houses than their base density.
    const target = Math.round(d.density * (d.kind === "village" ? 1.35 : 1));
    let placed = 0;
    const clear = plazaClear(d);
    for (let attempt = 0; attempt < target * 14 && placed < target; attempt++) {
      const ang = rng.next() * Math.PI * 2;
      const rr = Math.sqrt(rng.next()) * (d.r - 12);
      const x = fx + Math.cos(ang) * rr;
      const z = fz + Math.sin(ang) * rr;
      if (Math.hypot(x - fx, z - fz) < clear + 8) continue;
      // keep two main streets clear through the district
      if (Math.abs(x - fx) < ROAD_HALF || Math.abs(z - fz) < ROAD_HALF) continue;
      // a diagonal ring road keeps the town from becoming a solid block
      if (d.r > 350 && Math.abs(Math.abs(x - fx) - Math.abs(z - fz)) < 6 && rng.next() < 0.9) continue;
      const yaw = rng.next() < 0.5 ? 0 : Math.PI / 2 + (rng.next() - 0.5) * 0.14;
      let shape: Shape = "house";
      let roof: RoofKind = "gable";
      let w: number;
      let dd: number;
      let floors: number;
      if (style === "stone") {
        w = rng.range(9, 15);
        dd = rng.range(9, 14);
        floors = 3 + Math.floor(rng.next() * 3);
        roof = rng.next() < 0.4 ? "flat" : "gable";
        if (rng.next() < 0.08) shape = "tower";
      } else if (style === "plaster") {
        w = rng.range(7, 11);
        dd = rng.range(6, 10);
        floors = 2 + Math.floor(rng.next() * 2);
        roof = rng.next() < 0.3 ? "hip" : "gable";
      } else if (style === "timber") {
        w = rng.range(6, 10);
        dd = rng.range(6, 9);
        floors = 1 + Math.floor(rng.next() * 2);
        roof = rng.next() < 0.5 ? "thatch" : "gable";
        if (rng.next() < 0.12) shape = "barn";
      } else {
        // farm
        w = rng.range(7, 11);
        dd = rng.range(6, 9);
        floors = 1 + Math.floor(rng.next() * 2);
        roof = rng.next() < 0.5 ? "thatch" : "gable";
        if (rng.next() < 0.22) {
          shape = "barn";
          w = rng.range(9, 13);
          dd = rng.range(16, 24);
          floors = 1;
        }
      }
      if (rng.next() < 0.06 && shape === "house") shape = "shop";
      if (!footprintFits(x, z, w, dd, yaw)) continue;
      mk({
        district: d.id,
        shape,
        style: style === "stone" ? "stone" : style,
        roof,
        x,
        z,
        yaw,
        w,
        d: dd,
        floors,
      });
      placed++;
    }
  }

  // ---------------- farmland annuli (Sina↔Rose, Rose↔Maria) and abandoned ruins outside Maria
  const farmPass = (inner: number, outer: number, count: number, style: Style) => {
    let placed = 0;
    for (let attempt = 0; attempt < count * 18 && placed < count; attempt++) {
      const ang = rng.next() * Math.PI * 2;
      const rr = rng.range(inner, outer);
      const x = Math.cos(ang) * rr;
      const z = Math.sin(ang) * rr;
      const w = rng.range(7, 11);
      const dd = rng.range(6, 10);
      const yaw = rng.next() * Math.PI;
      if (!footprintFits(x, z, w, dd, yaw)) continue;
      if (inForest(x, z)) continue;
      const sh: Shape = rng.next() < 0.2 ? "barn" : rng.next() < 0.05 ? "mill" : "house";
      if (sh === "mill") {
        mk({ district: "farm", shape: "mill", style: "farm", roof: "none", x, z, yaw: 0, w: 8, d: 8, floors: 1, destructible: true, hp: 300 });
      } else {
        mk({ district: "farm", shape: sh, style, roof: sh === "barn" ? "gable" : rng.next() < 0.5 ? "thatch" : "gable", x, z, yaw, w: sh === "barn" ? rng.range(9, 12) : w, d: sh === "barn" ? rng.range(16, 22) : dd, floors: 1 + (rng.next() < 0.3 ? 1 : 0) });
      }
      placed++;
    }
  };
  farmPass(SINA_R + 80, ROSE_R - 80, 60, "farm");
  farmPass(ROSE_R + 80, MARIA_R - 80, 110, "farm");
  // Abandoned farmsteads just outside Wall Maria (ruined, not destructible by walls)
  for (let i = 0; i < 70; i++) {
    const ang = rng.range(0, Math.PI * 2);
    const rr = rng.range(MARIA_R + 90, MARIA_R + 2500);
    const x = Math.cos(ang) * rr;
    const z = Math.sin(ang) * rr;
    const yaw = rng.next() * Math.PI;
    if (!footprintFits(x, z, 8, 7, yaw)) continue;
    mk({ district: "outside", shape: "ruin", style: "ruin", roof: "none", x, z, yaw, w: 8, d: 7, floors: 1, destructible: false, hp: 99999, chimney: false });
  }

  // ---------------- forests of giant trees
  for (const f of FORESTS) {
    let placed = 0;
    for (let attempt = 0; attempt < f.trees * 10 && placed < f.trees; attempt++) {
      const ang = rng.next() * Math.PI * 2;
      const rr = Math.sqrt(rng.next()) * f.r;
      const x = f.c.x + Math.cos(ang) * rr;
      const z = f.c.z + Math.sin(ang) * rr;
      if (!f.inside && Math.hypot(x, z) < MARIA_R + 20) continue;
      if (f.inside && ringBlocked(x, z)) continue;
      if (nearDepot(x, z) || inBreach(x, z)) continue;
      if (trees.some((t) => (t.x - x) ** 2 + (t.z - z) ** 2 < 15 * 15)) continue;
      // trees do not stand inside built-up footprints
      if (occ.hits(x - 3, x + 3, z - 3, z + 3)) continue;
      trees.push({ x, z, h: rng.range(68, 84), r: rng.range(2.4, 3.6) });
      occ.add(x - 3, x + 3, z - 3, z + 3);
      placed++;
    }
  }

  return { buildings: out, gatehouses, trees, fountains, depotSites: DEPOTS.map((d) => ({ id: d.id, x: d.c.x, z: d.c.z })), forestCount: FORESTS.length };
}
