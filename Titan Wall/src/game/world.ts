import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RNG, clamp, angleDiff } from "./math";
import { NavGrid } from "./nav";
import { generateLayout } from "./city";
import type { Layout, TreeSpec } from "./city";
import { BuildingChunks, buildingMaterials, finish } from "./buildings";
import type { BuildingSpec } from "./buildings";
import { WALL_H, WALL_T, SINA_R, ROSE_R, MARIA_R, MAP_R, OCEAN_R, PLAYER_START, SHIG_GATE, SHIG_GATE_HALF, DEPOTS, DISTRICTS, FORESTS } from "./lore";
import type { RayHit } from "./types";

const _yAxis = new THREE.Vector3(0, 1, 0);

// ----------------------------------------------------------------------------- collision boxes
/**
 * Oriented box. `cx,cz` is the footprint centre, `hx` the half-width along the box's local X
 * (rotated by `yaw`), `hz` along local Z, and it stands from y=0 to `y1`.
 * Local X maps to world (cos yaw, -sin yaw); local Z maps to (sin yaw, cos yaw).
 */
export interface Box {
  kind: "building" | "wall" | "gate" | "tree" | "fountain";
  cx: number;
  cz: number;
  hx: number;
  hz: number;
  yaw: number;
  c: number;
  s: number;
  y1: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  spec?: BuildingSpec;
  ring?: "sina" | "rose" | "maria";
  angle?: number;
  alive: boolean;
  cells: number[];
  stamp: number;
  idx: number;
}

export interface Contact {
  impact: number;
  normal: THREE.Vector3;
  grounded: boolean;
  touching: boolean;
  box: Box | null;
}
export const newContact = (): Contact => ({ impact: 0, normal: new THREE.Vector3(), grounded: false, touching: false, box: null });

export function makeBox(kind: Box["kind"], cx: number, cz: number, hx: number, hz: number, yaw: number, y1: number): Box {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const ex = Math.abs(hx * c) + Math.abs(hz * s);
  const ez = Math.abs(hx * s) + Math.abs(hz * c);
  return {
    kind,
    cx,
    cz,
    hx,
    hz,
    yaw,
    c,
    s,
    y1,
    minX: cx - ex,
    maxX: cx + ex,
    minZ: cz - ez,
    maxZ: cz + ez,
    alive: true,
    cells: [],
    stamp: 0,
    idx: -1,
  };
}

const _lq = new THREE.Vector3();
/** Closest point on an oriented box to p. Writes the world-space point into `out` and returns squared distance. */
export function boxClosest(b: Box, px: number, py: number, pz: number, out: THREE.Vector3) {
  const dx = px - b.cx;
  const dz = pz - b.cz;
  const lx = dx * b.c - dz * b.s;
  const lz = dx * b.s + dz * b.c;
  const qx = clamp(lx, -b.hx, b.hx);
  const qz = clamp(lz, -b.hz, b.hz);
  const qy = clamp(py, 0, b.y1);
  out.set(b.cx + qx * b.c + qz * b.s, qy, b.cz - qx * b.s + qz * b.c);
  const ex = lx - qx;
  const ez = lz - qz;
  const ey = py - qy;
  return ex * ex + ey * ey + ez * ez;
}

let _nx = 0;
let _ny = 0;
let _nz = 0;
/** Slab test of a ray against an oriented box. Returns entry t or -1; writes the world normal to _nx/_ny/_nz. */
function rayOBB(b: Box, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number) {
  const ex = ox - b.cx;
  const ez = oz - b.cz;
  const lox = ex * b.c - ez * b.s;
  const loz = ex * b.s + ez * b.c;
  const ldx = dx * b.c - dz * b.s;
  const ldz = dx * b.s + dz * b.c;
  let t0 = 0;
  let t1 = maxT;
  let nlx = 0;
  let nly = 0;
  let nlz = 0;
  // axis x in [-hx, hx]
  const axes: [number, number, number, number, number][] = [
    [lox, ldx, -b.hx, b.hx, 0],
    [oy, dy, 0, b.y1, 1],
    [loz, ldz, -b.hz, b.hz, 2],
  ];
  for (const [o, d, lo, hi, ax] of axes) {
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return -1;
      continue;
    }
    let a = (lo - o) / d;
    let bb = (hi - o) / d;
    let sign = d > 0 ? -1 : 1;
    if (a > bb) {
      [a, bb] = [bb, a];
      sign = -sign;
    }
    if (a > t0) {
      t0 = a;
      nlx = nly = nlz = 0;
      if (ax === 0) nlx = sign;
      else if (ax === 1) nly = sign;
      else nlz = sign;
    }
    if (bb < t1) t1 = bb;
    if (t0 > t1) return -1;
  }
  if (nlx === 0 && nly === 0 && nlz === 0) return -1;
  _nx = nlx * b.c + nlz * b.s;
  _ny = nly;
  _nz = -nlx * b.s + nlz * b.c;
  return t0;
}

// ----------------------------------------------------------------------------- textures
function terrainTexture(layout: Layout): THREE.Texture | null {
  if (typeof document === "undefined") return null;
  const N = 4096;
  const S = N / (OCEAN_R * 2);
  const c = document.createElement("canvas");
  c.width = N;
  c.height = N;
  const g = c.getContext("2d");
  if (!g) return null;
  const P = (x: number) => (x + OCEAN_R) * S;
  const rnd = new RNG(99);
  g.fillStyle = "#2c5b78"; // sea
  g.fillRect(0, 0, N, N);
  // land disc
  g.fillStyle = "#6f8f4d";
  g.beginPath();
  g.arc(P(0), P(0), (MAP_R + 350) * S, 0, Math.PI * 2);
  g.fill();
  // meadow variation
  for (let i = 0; i < 2200; i++) {
    const x = rnd.range(0, N);
    const y = rnd.range(0, N);
    const v = rnd.next();
    g.fillStyle = v < 0.5 ? "rgba(70,100,50,0.25)" : "rgba(150,170,95,0.22)";
    g.beginPath();
    g.ellipse(x, y, rnd.range(10, 40), rnd.range(6, 22), rnd.next() * Math.PI, 0, Math.PI * 2);
    g.fill();
  }
  // farmland strips in the annuli between walls
  const farmCols = ["#c9a95c", "#b98f4a", "#8fa257", "#a9b35f", "#7a5b3a", "#d7bf7a"];
  for (const [r0, r1] of [
    [SINA_R + 60, ROSE_R - 60],
    [ROSE_R + 60, MARIA_R - 60],
  ] as const) {
    for (let i = 0; i < 1600; i++) {
      const ang = rnd.next() * Math.PI * 2;
      const rr = rnd.range(r0, r1);
      const x = Math.cos(ang) * rr;
      const z = Math.sin(ang) * rr;
      const w = rnd.range(60, 170);
      const h = rnd.range(30, 80);
      g.save();
      g.translate(P(x), P(z));
      g.rotate(Math.floor(rnd.next() * 4) * (Math.PI / 2) + rnd.range(-0.05, 0.05));
      g.fillStyle = farmCols[Math.floor(rnd.next() * farmCols.length)];
      g.globalAlpha = 0.75;
      g.fillRect((-w / 2) * S, (-h / 2) * S, w * S, h * S);
      g.restore();
    }
  }
  g.globalAlpha = 1;
  // forests
  for (const f of FORESTS) {
    g.fillStyle = f.inside ? "#2f4f2a" : "#284a26";
    g.beginPath();
    g.arc(P(f.c.x), P(f.c.z), f.r * S, 0, Math.PI * 2);
    g.fill();
    for (let i = 0; i < 260; i++) {
      const a = rnd.next() * Math.PI * 2;
      const rr = Math.sqrt(rnd.next()) * f.r;
      g.fillStyle = rnd.next() < 0.5 ? "rgba(20,40,20,0.35)" : "rgba(80,110,60,0.25)";
      g.beginPath();
      g.arc(P(f.c.x + Math.cos(a) * rr), P(f.c.z + Math.sin(a) * rr), rnd.range(6, 16) * S, 0, Math.PI * 2);
      g.fill();
    }
  }
  // wall rings (drawn as thick ink lines so the map reads from the air)
  for (const R of [SINA_R, ROSE_R, MARIA_R]) {
    g.strokeStyle = "rgba(90,84,74,0.9)";
    g.lineWidth = Math.max(2, WALL_T * S);
    g.beginPath();
    g.arc(P(0), P(0), R * S, 0, Math.PI * 2);
    g.stroke();
  }
  // roads: from every district centre out to the Maria gate and along the Sina/Rose ring
  g.strokeStyle = "#b59d74";
  g.lineWidth = 7;
  for (const d of DISTRICTS) {
    g.beginPath();
    g.moveTo(P(d.c.x), P(d.c.z));
    g.lineTo(P(0), P(0));
    g.stroke();
  }
  g.lineWidth = 5;
  g.strokeStyle = "rgba(181,157,116,0.8)";
  g.beginPath();
  g.moveTo(P(0), P(SHIG_GATE.z - 60));
  g.lineTo(P(0), P(4200));
  g.stroke();
  // districts: cobbled cores
  for (const d of DISTRICTS) {
    g.fillStyle = d.kind === "capital" ? "#a59e90" : "#8d8577";
    g.beginPath();
    g.arc(P(d.c.x), P(d.c.z), d.r * S * 0.92, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "rgba(60,58,52,0.35)";
    g.beginPath();
    g.arc(P(d.c.x), P(d.c.z), d.r * S * 0.92, 0, Math.PI * 2);
    g.lineWidth = 2;
    g.strokeStyle = "rgba(60,58,52,0.55)";
    g.stroke();
  }
  // Shiganshina breach scar (the section the wave-10 colossal kicks open)
  g.fillStyle = "#6a6052";
  g.beginPath();
  g.arc(P(SHIG_GATE.x), P(SHIG_GATE.z), (SHIG_GATE_HALF + 30) * S, 0, Math.PI * 2);
  g.fill();
  void layout;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// ----------------------------------------------------------------------------- world
export interface Depot {
  id: string;
  name: string;
  pos: THREE.Vector3;
  radius: number;
  active: boolean;
  beacon: THREE.MeshBasicMaterial;
  ring: THREE.MeshBasicMaterial;
}

interface Segment {
  box: Box;
  geo: THREE.BufferGeometry;
}
interface RingVisual {
  id: "sina" | "rose" | "maria";
  R: number;
  segs: Segment[];
  mesh: THREE.Mesh;
  merlons: THREE.InstancedMesh;
  merlonBase: THREE.Matrix4[];
  merlonAng: number[];
}

interface Debris {
  obj: THREE.Object3D;
  life: number;
}

const HALF = OCEAN_R + 300;
const GRID = 48;

export class World {
  readonly group = new THREE.Group();
  readonly boxes: Box[] = [];
  readonly depots: Depot[] = [];
  readonly fountains: { x: number; z: number; r: number }[] = [];
  readonly half = MAP_R;
  readonly bound = MAP_R;
  readonly layout: Layout;
  readonly chunks: BuildingChunks;
  nav!: NavGrid;
  playerSpawn = new THREE.Vector3(PLAYER_START.x, 1, PLAYER_START.z);
  private rings: RingVisual[] = [];
  private grid: (Box[] | undefined)[];
  private cols: number;
  private stampN = 1;
  private qbuf: Box[] = [];
  private debris: Debris[] = [];
  private time = 0;
  private rng: RNG;
  private breaches = new Set<string>();
  treeMesh: THREE.InstancedMesh | null = null;
  canopyMesh: THREE.InstancedMesh | null = null;

  constructor(seed = 1337) {
    this.rng = new RNG(seed);
    this.cols = Math.ceil((HALF * 2) / GRID);
    this.grid = new Array(this.cols * this.cols);
    this.layout = generateLayout(seed);
    this.buildTerrain();
    this.buildRings();
    this.buildGatehouses();
    this.buildFountains();
    this.buildTrees();
    this.buildDepots();
    this.chunks = new BuildingChunks(this.layout.buildings, 160, HALF);
    for (const s of this.layout.buildings) this.addBuildingBox(s);
    this.buildWilderness();
    this.buildProps(); // after the building boxes, so props keep clear of every house
    this.group.add(this.chunks.group);
    this.chunks.buildAll();
    this.nav = new NavGrid(HALF, 20);
    this.rebuildNav();
  }

  // ------------------------------------------------------------------ grid
  private cellRange(v: number) {
    return Math.max(0, Math.min(this.cols - 1, Math.floor((v + HALF) / GRID)));
  }
  private insert(b: Box) {
    b.idx = this.boxes.length;
    this.boxes.push(b);
    const x0 = this.cellRange(b.minX);
    const x1 = this.cellRange(b.maxX);
    const z0 = this.cellRange(b.minZ);
    const z1 = this.cellRange(b.maxZ);
    b.cells = [];
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++) {
        const k = z * this.cols + x;
        (this.grid[k] ??= []).push(b);
        b.cells.push(k);
      }
  }
  removeBox(b: Box) {
    if (!b.alive) return;
    b.alive = false;
    for (const k of b.cells) {
      const arr = this.grid[k];
      if (!arr) continue;
      const i = arr.indexOf(b);
      if (i >= 0) arr.splice(i, 1);
    }
    b.cells = [];
    const last = this.boxes.pop()!;
    if (last !== b) {
      this.boxes[b.idx] = last;
      last.idx = b.idx;
    }
    b.idx = -1;
  }
  private addBuildingBox(s: BuildingSpec) {
    const hw = s.w / 2;
    const hd = s.d / 2;
    const top = s.shape === "ruin" ? s.wallH : s.top;
    const b = makeBox(s.shape === "gatehouse" ? "gate" : "building", s.x, s.z, hw, hd, s.yaw, top);
    b.spec = s;
    this.insert(b);
    return b;
  }
  /** Boxes whose AABB overlaps the square around (x,z). The returned array is reused; copy if you keep it. */
  boxesNear(x: number, z: number, r: number): Box[] {
    return this.boxesInRect(x - r, x + r, z - r, z + r);
  }
  boxesInRect(x0: number, x1: number, z0: number, z1: number): Box[] {
    const out = this.qbuf;
    out.length = 0;
    const st = ++this.stampN;
    const cx0 = this.cellRange(x0);
    const cx1 = this.cellRange(x1);
    const cz0 = this.cellRange(z0);
    const cz1 = this.cellRange(z1);
    for (let z = cz0; z <= cz1; z++)
      for (let x = cx0; x <= cx1; x++) {
        const arr = this.grid[z * this.cols + x];
        if (!arr) continue;
        for (const b of arr) {
          if (b.stamp === st) continue;
          b.stamp = st;
          if (b.maxX < x0 || b.minX > x1 || b.maxZ < z0 || b.minZ > z1) continue;
          out.push(b);
        }
      }
    return out;
  }

  // ------------------------------------------------------------------ geometry queries
  raycast(o: THREE.Vector3, d: THREE.Vector3, maxDist: number): RayHit | null {
    const ex = o.x + d.x * maxDist;
    const ez = o.z + d.z * maxDist;
    let bestT = maxDist;
    let best: Box | null = null;
    let nx = 0;
    let ny = 0;
    let nz = 0;
    const cands = this.boxesInRect(Math.min(o.x, ex), Math.max(o.x, ex), Math.min(o.z, ez), Math.max(o.z, ez));
    for (const b of cands) {
      const t = rayOBB(b, o.x, o.y, o.z, d.x, d.y, d.z, bestT);
      if (t >= 0 && t < bestT) {
        bestT = t;
        best = b;
        nx = _nx;
        ny = _ny;
        nz = _nz;
      }
    }
    if (d.y < -1e-5 && o.y > 0) {
      const t = -o.y / d.y;
      if (t >= 0 && t < bestT) {
        bestT = t;
        best = null;
        nx = 0;
        ny = 1;
        nz = 0;
        return {
          dist: t,
          point: new THREE.Vector3(o.x + d.x * t, 0, o.z + d.z * t),
          normal: new THREE.Vector3(0, 1, 0),
          kind: "ground",
        };
      }
    }
    if (!best) return null;
    return {
      dist: bestT,
      point: new THREE.Vector3(o.x + d.x * bestT, o.y + d.y * bestT, o.z + d.z * bestT),
      normal: new THREE.Vector3(nx, ny, nz),
      kind: "box",
      box: best,
    };
  }

  segmentBlocked(a: THREE.Vector3, b: THREE.Vector3) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 1e-4) return false;
    const ix = dx / len;
    const iy = dy / len;
    const iz = dz / len;
    const cands = this.boxesInRect(Math.min(a.x, b.x), Math.max(a.x, b.x), Math.min(a.z, b.z), Math.max(a.z, b.z));
    for (const bx of cands) {
      const t = rayOBB(bx, a.x, a.y, a.z, ix, iy, iz, len);
      if (t >= 0 && t <= len) return true;
    }
    return false;
  }

  /** Push a sphere out of all solids, remove inward velocity and report the strongest impact. */
  resolveSphere(pos: THREE.Vector3, vel: THREE.Vector3, r: number, c: Contact) {
    c.impact = 0;
    c.grounded = false;
    c.touching = false;
    c.box = null;
    c.normal.set(0, 0, 0);
    const near = this.boxesNear(pos.x, pos.z, r + 1);
    const q = _lq;
    for (const b of near) {
      if (pos.y > b.y1 + r || pos.y < -r) continue;
      const d2 = boxClosest(b, pos.x, pos.y, pos.z, q);
      if (d2 >= r * r) continue;
      let nx: number;
      let ny: number;
      let nz: number;
      let pen: number;
      if (d2 > 1e-10) {
        const d = Math.sqrt(d2);
        nx = (pos.x - q.x) / d;
        ny = (pos.y - q.y) / d;
        nz = (pos.z - q.z) / d;
        pen = r - d;
      } else {
        // centre inside the box: push out through the nearest face
        const dx = pos.x - b.cx;
        const dz = pos.z - b.cz;
        const lx = dx * b.c - dz * b.s;
        const lz = dx * b.s + dz * b.c;
        const opts: [number, number, number, number, number][] = [
          [b.hx + lx, -1, 0, 0, 0],
          [b.hx - lx, 1, 0, 0, 0],
          [b.hz + lz, 0, 0, -1, 0],
          [b.hz - lz, 0, 0, 1, 0],
          [pos.y, 0, -1, 0, 0],
          [b.y1 - pos.y, 0, 1, 0, 0],
        ];
        opts.sort((p, q2) => p[0] - q2[0]);
        const o = opts[0];
        const lnx = o[1];
        const lnz = o[3];
        nx = lnx * b.c + lnz * b.s;
        ny = o[2];
        nz = -lnx * b.s + lnz * b.c;
        pen = o[0] + r;
      }
      pos.x += nx * pen;
      pos.y += ny * pen;
      pos.z += nz * pen;
      const vn = vel.x * nx + vel.y * ny + vel.z * nz;
      if (vn < 0) {
        vel.x -= nx * vn;
        vel.y -= ny * vn;
        vel.z -= nz * vn;
        if (-vn > c.impact) {
          c.impact = -vn;
          c.normal.set(nx, ny, nz);
          c.box = b;
        }
      }
      if (ny > 0.6) c.grounded = true;
      c.touching = true;
    }
    if (pos.y < r) {
      pos.y = r;
      if (vel.y < 0) {
        const imp = -vel.y;
        vel.y = 0;
        if (imp > c.impact) {
          c.impact = imp;
          c.normal.set(0, 1, 0);
          c.box = null;
        }
      }
      c.grounded = true;
      c.touching = true;
    }
  }

  /** The standing wall segment near (x,z), if any (breached segments are removed from the grid). */
  wallAt(x: number, z: number, maxDist = 14): Box | null {
    for (const b of this.boxesNear(x, z, maxDist)) if (b.kind === "wall") return b;
    return null;
  }

  nearestDepot(p: THREE.Vector3) {
    let best = this.depots[0];
    let bd = 1e9;
    for (const d of this.depots) {
      const dd = (d.pos.x - p.x) ** 2 + (d.pos.z - p.z) ** 2;
      if (dd < bd) {
        bd = dd;
        best = d;
      }
    }
    return best;
  }

  // ------------------------------------------------------------------ destruction
  /** Collapse a building: remove collision, hide its mesh, leave rubble, refresh the nav grid. */
  destroyBuilding(b: Box): BuildingSpec | null {
    const s = b.spec;
    if (!s || !s.alive || !s.destructible) return null;
    s.alive = false;
    this.removeBox(b);
    this.chunks.markDirty(s);
    this.spawnRubble(s.x, s.z, Math.max(s.w, s.d));
    this.refreshNav(s.x - s.w, s.x + s.w, s.z - s.d, s.z + s.d);
    return s;
  }

  /** Breach a wall section (wave-10 colossal kick). Removes wall segments and gatehouse within `width` metres of `angle`. */
  breachRing(ring: "sina" | "rose" | "maria", angle: number, width: number) {
    const rv = this.rings.find((r) => r.id === ring);
    if (!rv) return 0;
    const half = width / rv.R;
    let removed = 0;
    for (const seg of rv.segs) {
      if (!seg.box.alive) continue;
      if (Math.abs(angleDiff(angle, seg.box.angle ?? 0)) < half) {
        this.removeBox(seg.box);
        removed++;
      }
    }
    this.breaches.add(`${ring}:${angle.toFixed(3)}`);
    // remove the gatehouse on that spot too
    for (const b of this.boxesNear(Math.cos(angle) * rv.R, Math.sin(angle) * rv.R, 40)) {
      if (b.kind === "gate" && b.spec && b.spec.alive && Math.abs(angleDiff(Math.atan2(b.cz, b.cx), angle)) < half * 1.4) {
        b.spec.alive = false;
        this.chunks.markDirty(b.spec);
        this.removeBox(b);
      }
    }
    // rebuild the wall mesh with the gap in it
    const alive = rv.segs.filter((s) => s.box.alive).map((s) => s.geo);
    const merged = alive.length ? mergeGeometries(alive, false) : new THREE.BufferGeometry();
    rv.mesh.geometry.dispose();
    rv.mesh.geometry = merged ?? new THREE.BufferGeometry();
    // merlons inside the gap disappear
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < rv.merlonAng.length; i++) {
      const gone = Math.abs(angleDiff(angle, rv.merlonAng[i])) < half;
      rv.merlons.setMatrixAt(i, gone ? zero : rv.merlonBase[i]);
    }
    rv.merlons.instanceMatrix.needsUpdate = true;
    const cx = Math.cos(angle) * rv.R;
    const cz = Math.sin(angle) * rv.R;
    this.spawnRubble(cx, cz, width * 1.2, 20);
    this.refreshNav(cx - width, cx + width, cz - width, cz + width);
    return removed;
  }

  isBreached(ring: string, angle: number) {
    return this.breaches.has(`${ring}:${angle.toFixed(3)}`);
  }

  private spawnRubble(x: number, z: number, span: number, count = 9) {
    const g = new THREE.Group();
    const mats = buildingMaterials();
    const rng = this.rng;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    for (let i = 0; i < count; i++) {
      const size = 0.6 + rng.next() * Math.min(3.2, span * 0.12);
      const m = new THREE.Mesh(geo, mats.stone);
      m.scale.set(size * (0.8 + rng.next()), size * 0.6, size * (0.8 + rng.next()));
      m.position.set(x + (rng.next() - 0.5) * span * 0.9, size * 0.3, z + (rng.next() - 0.5) * span * 0.9);
      m.rotation.set(rng.next(), rng.next() * 3, rng.next());
      m.castShadow = true;
      g.add(m);
    }
    this.group.add(g);
    this.debris.push({ obj: g, life: 45 });
  }

  /** Re-compute nav heights for every nav cell overlapping the rectangle. */
  refreshNav(x0: number, x1: number, z0: number, z1: number) {
    const nav = this.nav;
    const [i0, i1] = nav.range(x0 - 20, x1 + 20);
    const [k0, k1] = nav.range(z0 - 20, z1 + 20);
    for (let z = k0; z <= k1; z++)
      for (let x = i0; x <= i1; x++) {
        const cx = nav.center(x);
        const cz = nav.center(z);
        let h = 0;
        for (const b of this.boxesInRect(cx - nav.cell / 2, cx + nav.cell / 2, cz - nav.cell / 2, cz + nav.cell / 2)) {
          if (b.y1 > h) h = b.y1;
        }
        nav.height[z * nav.n + x] = h;
      }
  }

  private rebuildNav() {
    const nav = this.nav;
    for (const b of this.boxes) {
      const [i0, i1] = nav.range(b.minX, b.maxX);
      const [k0, k1] = nav.range(b.minZ, b.maxZ);
      for (let z = k0; z <= k1; z++)
        for (let x = i0; x <= i1; x++) {
          const idx = z * nav.n + x;
          if (b.y1 > nav.height[idx]) nav.height[idx] = b.y1;
        }
    }
  }

  // ------------------------------------------------------------------ per frame
  update(dt: number) {
    this.time += dt;
    this.chunks.flush(2);
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.life -= dt;
      if (d.life <= 0) {
        this.group.remove(d.obj);
        d.obj.traverse((o) => {
          if ((o as THREE.Mesh).geometry) (o as THREE.Mesh).geometry.dispose?.();
        });
        this.debris.splice(i, 1);
      }
    }
    for (const d of this.depots) {
      const pulse = 0.5 + Math.sin(this.time * 3 + d.pos.x) * 0.15;
      d.beacon.opacity = d.active ? pulse * 0.45 : 0.14;
      d.beacon.color.set(d.active ? 0x59e0ff : 0xff4a3a);
      d.ring.color.set(d.active ? 0x59e0ff : 0xff4a3a);
    }
  }

  // ------------------------------------------------------------------ building the map
  private buildTerrain() {
    const tex = terrainTexture(this.layout);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(OCEAN_R * 2, OCEAN_R * 2),
      new THREE.MeshStandardMaterial({ color: tex ? 0xffffff : 0x587a43, map: tex ?? undefined, roughness: 1 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.03;
    ground.receiveShadow = true;
    this.group.add(ground);
  }

  private buildRings() {
    const wallMat = buildingMaterials().stone;
    const merlonGeo = new THREE.BoxGeometry(2.4, 2.2, 1.4);
    const merlonMat = new THREE.MeshStandardMaterial({ color: 0xbdb6a6, roughness: 0.95 });
    const defs: ["sina" | "rose" | "maria", number][] = [
      ["sina", SINA_R],
      ["rose", ROSE_R],
      ["maria", MARIA_R],
    ];
    for (const [id, R] of defs) {
      const N = Math.round((2 * Math.PI * R) / 30);
      const dth = (2 * Math.PI) / N;
      const segs: Segment[] = [];
      const merlonList: THREE.Matrix4[] = [];
      const merlonAng: number[] = [];
      const m4 = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      for (let i = 0; i < N; i++) {
        const th = -Math.PI + (i + 0.5) * dth;
        const cx = Math.cos(th) * R;
        const cz = Math.sin(th) * R;
        const yaw = Math.atan2(-Math.cos(th), -Math.sin(th));
        const L = R * dth * 1.04;
        const box = makeBox("wall", cx, cz, L / 2, WALL_T / 2, yaw, WALL_H);
        box.ring = id;
        box.angle = th;
        this.insert(box);
        // visual geometry (world space)
        const g = new THREE.BoxGeometry(L, WALL_H, WALL_T);
        g.translate(0, WALL_H / 2, 0);
        m4.compose(new THREE.Vector3(cx, 0, cz), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, 1, 1));
        g.applyMatrix4(m4);
        segs.push({ box, geo: finish(g, 0xe2dacb, 7) });
        // merlons along both wall faces, placed every 4.6 m
        if (i % 2 === 0) {
          for (const off of [-WALL_T / 2 + 0.7, WALL_T / 2 - 0.7]) {
            const rr = R + off;
            m4.compose(
              new THREE.Vector3(Math.cos(th) * rr, WALL_H + 1.1, Math.sin(th) * rr),
              q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw),
              new THREE.Vector3(1, 1, 1)
            );
            merlonList.push(m4.clone());
            merlonAng.push(th);
          }
        }
      }
      const mesh = new THREE.Mesh(mergeGeometries(segs.map((s) => s.geo), false) ?? new THREE.BufferGeometry(), wallMat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      const merlons = new THREE.InstancedMesh(merlonGeo, merlonMat, merlonList.length);
      merlonList.forEach((m, i) => merlons.setMatrixAt(i, m));
      merlons.castShadow = true;
      this.group.add(merlons);
      this.rings.push({ id, R, segs, mesh, merlons, merlonBase: merlonList, merlonAng });
    }
  }

  private buildGatehouses() {
    let id = 900000;
    for (const g of this.layout.gatehouses) {
      const spec: BuildingSpec = {
        id: id++,
        district: g.ring,
        shape: "gatehouse",
        style: "gatehouse",
        roof: "none",
        x: g.x,
        z: g.z,
        yaw: g.yaw,
        w: g.w,
        d: g.d,
        floors: 0,
        wallH: g.h,
        wallCol: 0xb8b2a4,
        roofCol: 0x5a5f66,
        chimney: false,
        hp: 1e9,
        maxHp: 1e9,
        destructible: false,
        alive: true,
        seed: id,
        top: g.h + 18,
      };
      this.layout.buildings.push(spec);
    }
  }

  private buildFountains() {
    const stone = new THREE.MeshStandardMaterial({ color: 0xc9c2b2, roughness: 0.85 });
    const water = new THREE.MeshStandardMaterial({ color: 0x3f8fb0, roughness: 0.08, metalness: 0.25, emissive: 0x0b2030, emissiveIntensity: 0.4 });
    for (const f of this.layout.fountains) {
      const grp = new THREE.Group();
      grp.position.set(f.x, 0, f.z);
      const basin = new THREE.Mesh(new THREE.CylinderGeometry(f.r, f.r + 0.5, 1.2, 28), stone);
      basin.position.y = 0.6;
      basin.castShadow = true;
      basin.receiveShadow = true;
      const rim = new THREE.Mesh(new THREE.TorusGeometry(f.r - 0.2, 0.22, 6, 28), stone);
      rim.rotation.x = Math.PI / 2;
      rim.position.y = 1.2;
      const pool = new THREE.Mesh(new THREE.CylinderGeometry(f.r - 0.6, f.r - 0.6, 0.12, 28), water);
      pool.position.y = 1.02;
      const tier = new THREE.Mesh(new THREE.CylinderGeometry(f.r * 0.45, f.r * 0.52, 0.8, 22), stone);
      tier.position.y = 1.6;
      const col = new THREE.Mesh(new THREE.CylinderGeometry(f.r * 0.12, f.r * 0.16, 3.4, 12), stone);
      col.position.y = 3.2;
      col.castShadow = true;
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(f.r * 0.32, f.r * 0.2, 0.5, 18), stone);
      bowl.position.y = 4.9;
      const spout = new THREE.Mesh(new THREE.SphereGeometry(f.r * 0.12, 10, 8), water);
      spout.position.y = 5.3;
      grp.add(basin, rim, pool, tier, col, bowl, spout);
      this.group.add(grp);
      this.fountains.push({ x: f.x, z: f.z, r: f.r });
      const b = makeBox("fountain", f.x, f.z, f.r * 0.92, f.r * 0.92, 0, 1.3);
      this.insert(b);
    }
  }

  private grassGeo: THREE.BufferGeometry | null = null;
  private grassMat: THREE.Material | null = null;
  private grassIM: THREE.InstancedMesh | null = null;
  private grassAt: { x: number; z: number } | null = null;

  /**
   * Keep a dense ring of grass around (x, z). It is regenerated after the focus moves 120 m, and the
   * positions come from a fixed hash, so the same ground is covered every time.
   */
  setFocus(x: number, z: number) {
    if (!this.grassGeo || !this.grassMat) return;
    if (this.grassAt && Math.hypot(x - this.grassAt.x, z - this.grassAt.z) < 120) return;
    this.grassAt = { x, z };
    const R = 700;
    const STEP = 8;
    const cap = 40000;
    if (!this.grassIM) {
      this.grassIM = new THREE.InstancedMesh(this.grassGeo, this.grassMat, cap);
      this.grassIM.castShadow = false;
      // the bounding sphere of an instanced mesh is fixed at creation, so culling would drop the grass; keep it on
      this.grassIM.frustumCulled = false;
      this.grassIM.receiveShadow = true;
      this.grassIM.count = 0;
      this.group.add(this.grassIM);
    }
    const im = this.grassIM;
    const hash = (i: number, j: number, k: number) => {
      let h = (i * 374761393 + j * 668265263 + k * 2147483647) | 0;
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
    };
    const cols = [0x6f9446, 0x7fa653, 0x5f8a3c, 0x9aab5e, 0x8c9a4a];
    const col = new THREE.Color();
    const q = new THREE.Quaternion();
    const sc = new THREE.Vector3();
    const pos = new THREE.Vector3();
    const m = new THREE.Matrix4();
    let n = 0;
    const i0 = Math.floor((x - R) / STEP);
    const i1 = Math.floor((x + R) / STEP);
    const j0 = Math.floor((z - R) / STEP);
    const j1 = Math.floor((z + R) / STEP);
    for (let j = j0; j <= j1 && n < cap; j++) {
      for (let i = i0; i <= i1 && n < cap; i++) {
        const gx = i * STEP + hash(i, j, 1) * STEP;
        const gz = j * STEP + hash(i, j, 2) * STEP;
        if (Math.hypot(gx - x, gz - z) > R) continue;
        if (Math.hypot(gx, gz) > MAP_R - 60) continue;
        if (DISTRICTS.some((d) => (gx - d.c.x) ** 2 + (gz - d.c.z) ** 2 < (d.r + 40) ** 2)) continue;
        if ([SINA_R, ROSE_R, MARIA_R].some((w) => Math.abs(Math.hypot(gx, gz) - w) < 40)) continue;
        if (hash(i, j, 3) < 0.18) continue; // gaps: bare earth, paths, animal tracks
        const yaw = hash(i, j, 4) * 6.283;
        const s = 0.7 + hash(i, j, 5) * 0.7;
        q.setFromAxisAngle(_yAxis, yaw);
        // small tufts: they should read as grass, not as tents, when they are close
        sc.set(s * 0.55, s * (0.45 + hash(i, j, 6) * 0.5), s * 0.55);
        pos.set(gx, 0, gz);
        m.compose(pos, q, sc);
        im.setMatrixAt(n, m);
        im.setColorAt(n, col.setHex(cols[Math.floor(hash(i, j, 7) * cols.length)]));
        n++;
      }
    }
    im.count = n;
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
  }

  /**
   * Wilderness cover: grass, bushes, hedgerow trees, rock outcrops and dirt roads, scattered over the
   * fields and hills between the districts. Instanced and decoration only (no collision, no nav).
   * Districts keep their own dressing and are skipped, so the open land is never an empty plain.
   */
  private buildWilderness() {
    const rng = new RNG(909);
    const CELL = 110;
    const grassGeo = new THREE.ConeGeometry(0.55, 1.1, 4);
    grassGeo.translate(0, 0.55, 0);
    const bushGeo = new THREE.IcosahedronGeometry(1.4, 0);
    bushGeo.scale(1.2, 0.8, 1.2);
    bushGeo.translate(0, 0.8, 0);
    const rockGeo = new THREE.DodecahedronGeometry(1.6, 0);
    rockGeo.translate(0, 0.9, 0);
    const trunkGeo = new THREE.CylinderGeometry(0.35, 0.5, 4.5, 6);
    trunkGeo.translate(0, 2.25, 0);
    const canopyGeo = new THREE.IcosahedronGeometry(3.2, 0);
    canopyGeo.translate(0, 6.2, 0);
    const grassMat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: false, roughness: 1, flatShading: true });
    const bushMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true });
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x8c877b, roughness: 0.95, flatShading: true });
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a4330, roughness: 1 });
    const canopyMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true });
    const bushCols = [0x3f6b2e, 0x4d7a36, 0x6b8a3a, 0x34582a];
    const canopyCols = [0x2f5a2a, 0x3c6b32, 0x4f7a3a, 0x5e6e2f];

    const bushes: { m: THREE.Matrix4; c: number }[] = [];
    const trees: { m: THREE.Matrix4; c: number }[] = [];
    const rocks: THREE.Matrix4[] = [];
    const q = new THREE.Quaternion();
    const sc = new THREE.Vector3();
    const pos = new THREE.Vector3();
    const place = (x: number, y: number, z: number, yaw: number, s: number, sy = s) => {
      q.setFromAxisAngle(_yAxis, yaw);
      sc.set(s, sy, s);
      pos.set(x, y, z);
      return new THREE.Matrix4().compose(pos, q, sc);
    };
    const inDistrict = (x: number, z: number) => DISTRICTS.some((d) => (x - d.c.x) ** 2 + (z - d.c.z) ** 2 < (d.r + 70) ** 2);
    const nearWall = (x: number, z: number) => {
      const r = Math.hypot(x, z);
      return [SINA_R, ROSE_R, MARIA_R].some((w) => Math.abs(r - w) < 60);
    };
    const edge = MAP_R - 60;
    for (let gz = -MAP_R; gz <= MAP_R; gz += CELL) {
      for (let gx = -MAP_R; gx <= MAP_R; gx += CELL) {
        const x = gx + rng.range(-CELL * 0.4, CELL * 0.4);
        const z = gz + rng.range(-CELL * 0.4, CELL * 0.4);
        if (Math.hypot(x, z) > edge) continue;
        if (inDistrict(x, z) || nearWall(x, z)) continue;
        const r = rng.next();
        if (r < 0.34) {
          const n = 1 + Math.floor(rng.next() * 3);
          for (let i = 0; i < n; i++) {
            const c = bushCols[Math.floor(rng.next() * bushCols.length)];
            bushes.push({ m: place(x + rng.range(-20, 20), 0, z + rng.range(-20, 20), rng.next() * 6.28, rng.range(0.9, 1.9)), c });
          }
        } else if (r < 0.46) {
          const c = canopyCols[Math.floor(rng.next() * canopyCols.length)];
          trees.push({ m: place(x + rng.range(-25, 25), 0, z + rng.range(-25, 25), rng.next() * 6.28, rng.range(0.8, 1.5)), c });
        } else if (r < 0.5) {
          rocks.push(place(x + rng.range(-30, 30), 0, z + rng.range(-30, 30), rng.next() * 6.28, rng.range(0.8, 2.2), rng.range(0.6, 1.4)));
        }
      }
    }

    const fill = (geo: THREE.BufferGeometry, mat: THREE.Material, list: THREE.Matrix4[], shadow: boolean) => {
      if (!list.length) return;
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((mm, i) => im.setMatrixAt(i, mm));
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = shadow;
      im.receiveShadow = true;
      this.group.add(im);
    };
    // grass is dense near the player (see setFocus), not spread thinly over the whole map
    this.grassGeo = grassGeo;
    this.grassMat = grassMat;
    fill(rockGeo, rockMat, rocks, true);
    // coloured instances: set the colour per instance
    const coloured = (geo: THREE.BufferGeometry, mat: THREE.Material, list: { m: THREE.Matrix4; c: number }[], shadow: boolean) => {
      if (!list.length) return;
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      const col = new THREE.Color();
      list.forEach((it, i) => {
        im.setMatrixAt(i, it.m);
        im.setColorAt(i, col.setHex(it.c));
      });
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.castShadow = shadow;
      im.receiveShadow = true;
      this.group.add(im);
    };
    coloured(bushGeo, bushMat, bushes, false);
    coloured(canopyGeo, canopyMat, trees, true);
    fill(trunkGeo, trunkMat, trees.map((t) => t.m), true);

    // dirt roads: a chain between each district and its nearest neighbours
    const roadMat = new THREE.MeshStandardMaterial({ color: 0x8a7552, roughness: 1 });
    const roads: THREE.Matrix4[] = [];
    for (let i = 0; i < DISTRICTS.length; i++) {
      const a = DISTRICTS[i];
      const near = DISTRICTS.filter((b) => b !== a && Math.hypot(b.c.x - a.c.x, b.c.z - a.c.z) < 2600)
        .sort((p1, p2) => Math.hypot(p1.c.x - a.c.x, p1.c.z - a.c.z) - Math.hypot(p2.c.x - a.c.x, p2.c.z - a.c.z))
        .slice(0, 2);
      for (const b of near) {
        const dx = b.c.x - a.c.x;
        const dz = b.c.z - a.c.z;
        const len = Math.hypot(dx, dz);
        const yaw = Math.atan2(dx, dz);
        const steps = Math.floor(len / 40);
        for (let k = 0; k <= steps; k++) {
          const t = k / steps;
          roads.push(place(a.c.x + dx * t, 0.05, a.c.z + dz * t, yaw, 1, 1).multiply(new THREE.Matrix4().makeScale(7, 1, 40)));
        }
      }
    }
    if (roads.length) {
      const roadGeo = new THREE.PlaneGeometry(1, 1);
      roadGeo.rotateX(-Math.PI / 2);
      fill(roadGeo, roadMat, roads, false);
    }
  }

  /**
   * Village dressing: wells, haystacks and handcarts on the edges of towns and villages. These are
   * decoration only (no collision, not in the nav grid), placed where no building box is.
   */
  private buildProps() {
    const rng = new RNG(4242);
    const wood = new THREE.MeshStandardMaterial({ color: 0x7a5a3a, roughness: 0.95 });
    const stoneM = new THREE.MeshStandardMaterial({ color: 0x9b968a, roughness: 0.9 });
    const hay = new THREE.MeshStandardMaterial({ color: 0xc9a85a, roughness: 1 });
    const roofM = new THREE.MeshStandardMaterial({ color: 0x5c4630, roughness: 0.9 });
    const iron = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.6, metalness: 0.4 });
    const clear = (x: number, z: number) => {
      if (Math.hypot(x, z) > MARIA_R - 40) return false;
      for (const b of this.boxes) {
        if (x > b.minX - 3 && x < b.maxX + 3 && z > b.minZ - 3 && z < b.maxZ + 3) return false;
      }
      return true;
    };
    const place = (d: (typeof DISTRICTS)[number], make: (g: THREE.Group) => void) => {
      for (let tries = 0; tries < 80; tries++) {
        const a = rng.next() * Math.PI * 2;
        const rr = d.r * (0.4 + rng.next() * 0.7);
        const x = d.c.x + Math.cos(a) * rr;
        const z = d.c.z + Math.sin(a) * rr;
        if (!clear(x, z)) continue;
        const g = new THREE.Group();
        g.position.set(x, 0, z);
        g.rotation.y = rng.next() * Math.PI * 2;
        make(g);
        this.group.add(g);
        return true;
      }
      return false;
    };
    const add = (g: THREE.Group, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
    };
    for (const d of DISTRICTS) {
      if (d.kind !== "town" && d.kind !== "village") continue;
      const n = Math.round(d.r / 60);
      for (let i = 0; i < n; i++) {
        const kind = rng.next();
        if (kind < 0.34) {
          // village well: stone ring, two posts and a small roof
          place(d, (g) => {
            add(g, new THREE.CylinderGeometry(1.1, 1.2, 1.0, 14), stoneM, 0, 0.5, 0);
            add(g, new THREE.BoxGeometry(0.18, 2.2, 0.18), wood, -0.95, 1.6, 0);
            add(g, new THREE.BoxGeometry(0.18, 2.2, 0.18), wood, 0.95, 1.6, 0);
            add(g, new THREE.BoxGeometry(2.4, 0.14, 1.6), roofM, 0, 2.8, 0);
            add(g, new THREE.CylinderGeometry(0.12, 0.12, 1.9, 6), iron, 0, 1.6, 0);
          });
        } else if (kind < 0.67) {
          // haystack: a squat cone on a wooden base
          place(d, (g) => {
            add(g, new THREE.CylinderGeometry(0.2, 2.1, 2.4, 10), hay, 0, 1.4, 0);
            add(g, new THREE.CylinderGeometry(2.2, 2.2, 0.2, 10), wood, 0, 0.1, 0);
          });
        } else {
          // handcart on two wheels, tilted to one side
          place(d, (g) => {
            add(g, new THREE.BoxGeometry(1.9, 0.18, 2.6), wood, 0, 0.9, 0);
            add(g, new THREE.BoxGeometry(1.9, 0.6, 0.12), wood, 0, 1.2, 1.3);
            add(g, new THREE.BoxGeometry(1.9, 0.6, 0.12), wood, 0, 1.2, -1.3);
            const w1 = new THREE.CylinderGeometry(0.6, 0.6, 0.14, 12);
            w1.rotateZ(Math.PI / 2);
            add(g, w1, wood, 1.05, 0.6, 0);
            add(g, w1, wood, -1.05, 0.6, 0);
            add(g, new THREE.BoxGeometry(0.12, 0.12, 4.2), wood, 0, 0.8, 3.4);
          });
        }
      }
    }
  }

  private buildTrees() {
    const trees: TreeSpec[] = this.layout.trees;
    if (!trees.length) return;
    const trunkGeo = new THREE.CylinderGeometry(1, 1.12, 1, 8);
    trunkGeo.translate(0, 0.5, 0);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a4330, roughness: 1 });
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, trees.length);
    const canopyGeo = new THREE.IcosahedronGeometry(1, 1);
    const canopyMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true });
    const canopy = new THREE.InstancedMesh(canopyGeo, canopyMat, trees.length * 3);
    const rng = new RNG(77);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const col = new THREE.Color();
    trees.forEach((t, i) => {
      m.compose(new THREE.Vector3(t.x, 0, t.z), q, new THREE.Vector3(t.r, t.h, t.r));
      trunks.setMatrixAt(i, m);
      this.insert(makeBox("tree", t.x, t.z, 2.2, 2.2, 0, t.h));
      for (let k = 0; k < 3; k++) {
        const y = t.h * (0.72 + k * 0.1);
        const rad = 7 + rng.next() * 5 - k * 1.2;
        const ang = rng.next() * 6;
        m.compose(
          new THREE.Vector3(t.x + Math.cos(ang) * 2.5 * (k - 1), y, t.z + Math.sin(ang) * 2.5 * (k - 1)),
          q,
          new THREE.Vector3(rad, rad * 0.7, rad)
        );
        canopy.setMatrixAt(i * 3 + k, m);
        col.setHSL(0.25 + rng.next() * 0.06, 0.38 + rng.next() * 0.1, 0.22 + rng.next() * 0.08);
        canopy.setColorAt(i * 3 + k, col);
      }
    });
    trunks.castShadow = true;
    canopy.castShadow = true;
    this.group.add(trunks, canopy);
    this.treeMesh = trunks;
    this.canopyMesh = canopy;
  }

  private buildDepots() {
    const crateMat = new THREE.MeshStandardMaterial({ color: 0x8a6a3f, roughness: 0.9 });
    const barrelMat = new THREE.MeshStandardMaterial({ color: 0x5b4a3a, roughness: 0.8 });
    const canvasMat = new THREE.MeshStandardMaterial({ color: 0xd9ceb4, roughness: 0.95, side: THREE.DoubleSide });
    const flagMat = new THREE.MeshStandardMaterial({ color: 0x3d5a3a, roughness: 0.8, side: THREE.DoubleSide });
    const wingMat = new THREE.MeshStandardMaterial({ color: 0x2b4a8a, roughness: 0.8, side: THREE.DoubleSide });
    for (const d of this.layout.depotSites) {
      const meta = DEPOTS.find((x) => x.id === d.id);
      const grp = new THREE.Group();
      grp.position.set(d.x, 0, d.z);
      // supply wagon with a canvas tilt
      const wagon = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.1, 2.2), barrelMat);
      wagon.position.set(-1.2, 1.2, -2.6);
      wagon.castShadow = true;
      const wheelGeo = new THREE.CylinderGeometry(0.9, 0.9, 0.25, 12);
      wheelGeo.rotateX(Math.PI / 2);
      for (const wx of [-2.4, 0.1]) {
        const w = new THREE.Mesh(wheelGeo, barrelMat);
        w.position.set(wx - 1.2, 0.9, -3.8);
        grp.add(w);
      }
      const tilt = new THREE.Mesh(new THREE.BoxGeometry(4.0, 1.2, 2.0), canvasMat);
      tilt.position.set(-1.2, 2.6, -2.6);
      tilt.castShadow = true;
      // tent
      const tent = new THREE.Mesh(new THREE.ConeGeometry(2.8, 2.6, 4, 1).rotateY(Math.PI / 4), canvasMat);
      tent.position.set(3.4, 1.3, 1.6);
      tent.castShadow = true;
      // crates & barrels
      for (const [ox, oz, s] of [
        [1.0, -0.6, 1.3],
        [1.9, -0.2, 1.0],
        [0.4, 0.9, 1.1],
      ] as [number, number, number][]) {
        const c = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), crateMat);
        c.position.set(ox, s / 2, oz);
        c.castShadow = true;
        grp.add(c);
      }
      for (const [ox, oz] of [
        [-3.2, 1.6],
        [-2.6, 1.7],
      ]) {
        const b = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 1.1, 10), barrelMat);
        b.position.set(ox, 0.55, oz);
        b.castShadow = true;
        grp.add(b);
      }
      // flag pole, Survey Corps wings banner
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 7, 6), crateMat);
      pole.position.set(-4.6, 3.5, 2.0);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.5), flagMat);
      flag.position.set(-3.4, 6.2, 2.0);
      const wing = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.6), wingMat);
      wing.position.set(-3.4, 6.2, 2.02);
      // beacon
      const beaconMat = new THREE.MeshBasicMaterial({ color: 0x59e0ff, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending });
      const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 18, 14, 1, true), beaconMat);
      beacon.position.y = 9;
      const ringMat = new THREE.MeshBasicMaterial({ color: 0x59e0ff, transparent: true, opacity: 0.55, side: THREE.DoubleSide });
      const ring = new THREE.Mesh(new THREE.RingGeometry(5.6, 6.2, 36), ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.06;
      grp.add(wagon, tilt, tent, pole, flag, wing, beacon, ring);
      this.group.add(grp);
      this.depots.push({
        id: d.id,
        name: meta?.name ?? d.id,
        pos: new THREE.Vector3(d.x, 0, d.z),
        radius: 6.5,
        active: true,
        beacon: beaconMat,
        ring: ringMat,
      });
    }
  }

  get stats() {
    return { boxes: this.boxes.length, rings: this.rings.length, chunksPending: this.chunks.pending };
  }
}

export { SINA_R, ROSE_R, MARIA_R };
