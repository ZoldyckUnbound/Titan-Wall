import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RNG } from "./math";

/** A single building in the city. Geometry is generated from this spec (see `buildParts`). */
export type Style = "plaster" | "timber" | "stone" | "farm" | "palace" | "church" | "gatehouse" | "ruin";
export type Shape = "house" | "hip" | "church" | "palace" | "tower" | "barn" | "mill" | "ruin" | "gatehouse" | "shop";
export type RoofKind = "gable" | "hip" | "flat" | "none" | "thatch";

export interface BuildingSpec {
  id: number;
  district: string;
  shape: Shape;
  style: Style;
  roof: RoofKind;
  x: number;
  z: number;
  yaw: number;
  /** Footprint in local space (x = width, z = depth). */
  w: number;
  d: number;
  floors: number;
  wallH: number;
  wallCol: number;
  roofCol: number;
  chimney: boolean;
  /** Structural hit points. Destructible buildings collapse when titans smash them. */
  hp: number;
  maxHp: number;
  destructible: boolean;
  alive: boolean;
  seed: number;
  /** Height of the highest point (eaves + roof), filled in by the layout code. */
  top: number;
}

// ----------------------------------------------------------------------------- textures
const TILE_M = 3.2; // one window bay per 3.2 m floor
let texCache: Partial<Record<"plaster" | "timber" | "stone" | "roof" | "farm", THREE.Texture>> = {};

function canvasTex(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void) {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const g = c.getContext("2d");
  if (!g) return null;
  draw(g, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function drawWindow(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, shutters: boolean) {
  g.fillStyle = "#e9e2d0";
  g.fillRect(x - 6, y - 6, w + 12, h + 12); // architrave
  g.fillStyle = "#2b3a4c";
  g.fillRect(x, y, w, h);
  const grad = g.createLinearGradient(x, y, x + w, y + h);
  grad.addColorStop(0, "rgba(160,190,215,0.35)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(x, y, w, h);
  g.fillStyle = "#ece6d6";
  g.fillRect(x + w / 2 - 2, y, 4, h);
  g.fillRect(x, y + h * 0.45, w, 3);
  g.fillStyle = "#b9ad93";
  g.fillRect(x - 10, y + h + 6, w + 20, 6); // sill
  if (shutters) {
    g.fillStyle = "#3f5a3c";
    g.fillRect(x - 14, y, 9, h);
    g.fillRect(x + w + 5, y, 9, h);
  }
}

function plasterTex() {
  if (!texCache.plaster)
    texCache.plaster = canvasTex(256, (g, s) => {
      g.fillStyle = "#ffffff";
      g.fillRect(0, 0, s, s);
      for (let i = 0; i < 900; i++) {
        const v = 215 + Math.floor(Math.random() * 40);
        g.fillStyle = `rgba(${v},${v - 4},${v - 12},0.35)`;
        g.fillRect(Math.random() * s, Math.random() * s, 2 + Math.random() * 3, 2 + Math.random() * 3);
      }
      g.fillStyle = "rgba(120,95,70,0.12)";
      g.fillRect(0, 0, s, 3); // floor line
      drawWindow(g, 88, 58, 80, 84, true);
    }) as THREE.Texture;
  return texCache.plaster ?? null;
}

function timberTex() {
  if (!texCache.timber)
    texCache.timber = canvasTex(256, (g, s) => {
      g.fillStyle = "#ffffff";
      g.fillRect(0, 0, s, s);
      for (let i = 0; i < 700; i++) {
        const v = 220 + Math.floor(Math.random() * 35);
        g.fillStyle = `rgba(${v},${v - 5},${v - 14},0.3)`;
        g.fillRect(Math.random() * s, Math.random() * s, 3, 3);
      }
      g.fillStyle = "#3d2a1d";
      g.fillRect(0, 0, 10, s);
      g.fillRect(s - 10, 0, 10, s);
      g.fillRect(0, 0, s, 10);
      g.fillRect(0, s - 10, s, 10);
      g.fillRect(0, 118, s, 9); // mid rail
      g.strokeStyle = "#3d2a1d";
      g.lineWidth = 7;
      g.beginPath();
      g.moveTo(10, 10);
      g.lineTo(60, 118);
      g.moveTo(246, 10);
      g.lineTo(196, 118);
      g.stroke();
      drawWindow(g, 92, 150, 72, 80, false);
    }) as THREE.Texture;
  return texCache.timber ?? null;
}

function stoneTex() {
  if (!texCache.stone)
    texCache.stone = canvasTex(256, (g, s) => {
      g.fillStyle = "#c9c4b8";
      g.fillRect(0, 0, s, s);
      const rows = 4;
      const rh = s / rows;
      for (let r = 0; r < rows; r++) {
        const off = r % 2 ? 64 : 0;
        for (let c = -1; c < 5; c++) {
          const v = 180 + Math.floor(Math.random() * 40);
          g.fillStyle = `rgb(${v},${v - 3},${v - 9})`;
          g.fillRect(c * 64 + off + 2, r * rh + 2, 60, rh - 4);
        }
      }
      drawWindow(g, 96, 58, 64, 84, false);
    }) as THREE.Texture;
  return texCache.stone ?? null;
}

function roofTex() {
  if (!texCache.roof)
    texCache.roof = canvasTex(256, (g, s) => {
      g.fillStyle = "#ffffff";
      g.fillRect(0, 0, s, s);
      for (let row = 0; row < 16; row++) {
        const off = row % 2 ? 16 : 0;
        for (let c = -1; c < 9; c++) {
          const v = 200 + Math.floor(Math.random() * 45);
          g.fillStyle = `rgb(${v},${v - 6},${v - 10})`;
          g.beginPath();
          g.arc(c * 32 + off + 16, row * 16 + 8, 15, 0, Math.PI);
          g.fill();
          g.fillStyle = "rgba(0,0,0,0.25)";
          g.fillRect(c * 32 + off, row * 16 + 8, 32, 2);
        }
      }
    }) as THREE.Texture;
  return texCache.roof ?? null;
}

function farmTex() {
  if (!texCache.farm)
    texCache.farm = canvasTex(256, (g, s) => {
      g.fillStyle = "#ffffff";
      g.fillRect(0, 0, s, s);
      for (let i = 0; i < 500; i++) {
        const v = 210 + Math.floor(Math.random() * 45);
        g.fillStyle = `rgba(${v},${v - 8},${v - 20},0.45)`;
        g.fillRect(Math.random() * s, Math.random() * s, 4, 1.5);
      }
      g.fillStyle = "#5b4a3a";
      g.fillRect(0, 0, s, 6);
      g.fillRect(0, s - 6, s, 6);
      drawWindow(g, 110, 80, 36, 42, false);
    }) as THREE.Texture;
  return texCache.farm ?? null;
}

const matCache = new Map<string, THREE.Material>();
/** Shared materials. Tint comes from per-vertex colours so every building keeps its own colour. */
export function buildingMaterials() {
  const get = (key: string, mk: () => THREE.Material) => {
    let m = matCache.get(key);
    if (!m) matCache.set(key, (m = mk()));
    return m;
  };
  const wall = (kind: "plaster" | "timber" | "stone" | "farm") =>
    get(`w${kind}`, () => {
      const map = kind === "plaster" ? plasterTex() : kind === "timber" ? timberTex() : kind === "stone" ? stoneTex() : farmTex();
      return new THREE.MeshStandardMaterial({ map, vertexColors: true, roughness: 0.92, metalness: 0 });
    });
  return {
    plaster: wall("plaster"),
    timber: wall("timber"),
    stone: wall("stone"),
    farm: wall("farm"),
    roof: get("roof", () => new THREE.MeshStandardMaterial({ map: roofTex(), vertexColors: true, roughness: 0.85 })),
    trim: get("trim", () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 })),
  };
}

// ----------------------------------------------------------------------------- geometry helpers
type Cat = "wall" | "roof" | "trim";
export type WallMat = "plaster" | "timber" | "stone" | "farm";
interface Bucket {
  wall: Record<WallMat, THREE.BufferGeometry[]>;
  roof: THREE.BufferGeometry[];
  trim: THREE.BufferGeometry[];
}
const wallMatOf = (st: Style): WallMat =>
  st === "timber" ? "timber" : st === "farm" ? "farm" : st === "plaster" ? "plaster" : "stone";

const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();

/** Recompute UVs from world positions so textures tile at real-world scale (3.2 m per bay). */
export function worldUV(g: THREE.BufferGeometry, scale: number) {
  const p = g.attributes.position as THREE.BufferAttribute;
  const n = g.attributes.normal as THREE.BufferAttribute;
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const nx = Math.abs(n.getX(i));
    const ny = Math.abs(n.getY(i));
    const nz = Math.abs(n.getZ(i));
    let u: number;
    let v: number;
    if (ny > 0.6) {
      u = x;
      v = z;
    } else if (nx > nz) {
      u = z;
      v = y;
    } else {
      u = x;
      v = y;
    }
    uv.setXY(i, u / scale, v / scale);
  }
  uv.needsUpdate = true;
}

/** Primitive geometry prepared for merging (non-indexed, with uv + colour). */
export function finish(g: THREE.BufferGeometry, color: number, scale: number) {
  const ng = g.index ? g.toNonIndexed() : g;
  if (ng !== g) g.dispose();
  const n = ng.attributes.position.count;
  const col = new THREE.Color(color);
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = col.r;
    arr[i * 3 + 1] = col.g;
    arr[i * 3 + 2] = col.b;
  }
  ng.setAttribute("color", new THREE.BufferAttribute(arr, 3));
  if (!ng.attributes.uv) ng.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  worldUV(ng, scale);
  return ng;
}

/** A polygon soup geometry (triangle fan per polygon) with outward normals. */
function polyGeo(polys: THREE.Vector3[][], center: THREE.Vector3) {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  for (const poly of polys) {
    const a = poly[0];
    const cen = new THREE.Vector3();
    for (const p of poly) cen.add(p);
    cen.divideScalar(poly.length);
    for (let i = 1; i < poly.length - 1; i++) {
      const b = poly[i];
      const c = poly[i + 1];
      const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
      if (n.dot(new THREE.Vector3().subVectors(cen, center)) < 0) {
        pos.push(a.x, a.y, a.z, c.x, c.y, c.z, b.x, b.y, b.z);
        for (let k = 0; k < 3; k++) nor.push(-n.x, -n.y, -n.z);
      } else {
        pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
        for (let k = 0; k < 3; k++) nor.push(n.x, n.y, n.z);
      }
      uv.push(0, 0, 0, 0, 0, 0);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

// ----------------------------------------------------------------------------- building parts
interface Ctx {
  s: BuildingSpec;
  xf: THREE.Matrix4;
  out: Bucket;
  rng: RNG;
  wallMat: WallMat;
}

function put(c: Ctx, cat: Cat, g: THREE.BufferGeometry, color: number, tx = 0, ty = 0, tz = 0, scale = TILE_M) {
  g.translate(tx, ty, tz);
  g.applyMatrix4(c.xf);
  const f = finish(g, color, cat === "roof" ? 2.4 : scale);
  if (cat === "roof") c.out.roof.push(f);
  else if (cat === "trim") c.out.trim.push(f);
  else c.out.wall[c.wallMat].push(f);
}

function putPoly(c: Ctx, cat: Cat, polys: THREE.Vector3[][], center: THREE.Vector3, color: number) {
  const g = polyGeo(polys, center);
  g.applyMatrix4(c.xf);
  const f = finish(g, color, cat === "roof" ? 2.4 : TILE_M);
  if (cat === "roof") c.out.roof.push(f);
  else c.out.wall[c.wallMat].push(f);
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Gable roof over a w×d footprint. Ridge runs along the long axis. Returns the roof polygons and the two gable triangles. */
function gableParts(w: number, d: number, h: number, ridgeZ: boolean) {
  const hw = w / 2;
  const hd = d / 2;
  const roof: THREE.Vector3[][] = [];
  const gables: THREE.Vector3[][] = [];
  if (ridgeZ) {
    // ridge along z, slopes face ±x, gables at z = ±hd
    roof.push([V(-hw, 0, -hd), V(-hw, 0, hd), V(0, h, hd), V(0, h, -hd)]);
    roof.push([V(hw, 0, -hd), V(0, h, -hd), V(0, h, hd), V(hw, 0, hd)]);
    gables.push([V(-hw, 0, -hd), V(0, h, -hd), V(hw, 0, -hd)]);
    gables.push([V(-hw, 0, hd), V(hw, 0, hd), V(0, h, hd)]);
  } else {
    roof.push([V(-hw, 0, -hd), V(hw, 0, -hd), V(hw, h, 0), V(-hw, h, 0)]);
    roof.push([V(-hw, 0, hd), V(-hw, h, 0), V(hw, h, 0), V(hw, 0, hd)]);
    gables.push([V(-hw, 0, -hd), V(-hw, 0, hd), V(-hw, h, 0)]);
    gables.push([V(hw, 0, -hd), V(hw, h, 0), V(hw, 0, hd)]);
  }
  return { roof, gables };
}

function hipParts(w: number, d: number, h: number) {
  const hw = w / 2;
  const hd = d / 2;
  const r = Math.max(0, hw - hd);
  const R1 = V(-r, h, 0);
  const R2 = V(r, h, 0);
  if (w >= d) {
    return [
      [V(-hw, 0, hd), V(hw, 0, hd), R2, R1],
      [V(hw, 0, -hd), V(-hw, 0, -hd), R1, R2],
      [V(-hw, 0, -hd), V(-hw, 0, hd), R1],
      [V(hw, 0, hd), V(hw, 0, -hd), R2],
    ];
  }
  // narrow in x: swap roles
  const R3 = V(0, h, -r);
  const R4 = V(0, h, r);
  return [
    [V(hw, 0, -hd), V(hw, 0, hd), R4, R3],
    [V(-hw, 0, hd), V(-hw, 0, -hd), R3, R4],
    [V(-hw, 0, -hd), V(hw, 0, -hd), R3],
    [V(hw, 0, hd), V(-hw, 0, hd), R4],
  ];
}

function addChimney(c: Ctx, x: number, y: number, z: number, h: number) {
  put(c, "wall", new THREE.BoxGeometry(0.9, h, 0.9), 0xa39a8c, x, y + h / 2, z);
  put(c, "trim", new THREE.BoxGeometry(1.1, 0.25, 1.1), 0x6e665a, x, y + h, z);
}

function addDoor(c: Ctx, x: number, z: number, faceZ: number, w = 1.2, h = 2.3) {
  put(c, "trim", new THREE.BoxGeometry(w, h, 0.12), 0x3a2619, x, h / 2, faceZ + 0.04);
  put(c, "trim", new THREE.BoxGeometry(w + 0.5, 0.25, 0.3), 0x8a7a64, x, h + 0.12, faceZ + 0.08); // lintel
  void z;
}

function buildHouse(c: Ctx) {
  const { s, rng } = c;
  const h = s.wallH;
  const ridgeZ = s.d >= s.w;
  const hw = s.w / 2;
  const hd = s.d / 2;
  // wall box
  put(c, "wall", new THREE.BoxGeometry(s.w, h, s.d), s.wallCol, 0, h / 2, 0);
  const roofH = Math.min(s.w, s.d) * (s.roof === "thatch" ? 0.62 : 0.5);
  if (s.roof === "hip") {
    for (const poly of hipParts(s.w, s.d, roofH)) putPoly(c, "roof", [poly.map((p) => V(p.x, p.y + h, p.z))], V(0, h + roofH * 0.3, 0), s.roofCol);
  } else if (s.roof === "gable" || s.roof === "thatch") {
    const { roof, gables } = gableParts(s.w, s.d, roofH, ridgeZ);
    const lift = (ps: THREE.Vector3[][]) => ps.map((p) => p.map((q) => V(q.x, q.y + h, q.z)));
    for (const p of lift(roof)) putPoly(c, "roof", [p], V(0, h + roofH * 0.3, 0), s.roofCol);
    for (const p of lift(gables)) putPoly(c, "wall", [p], V(0, h + roofH * 0.2, 0), s.wallCol);
    // eave overhang slabs
    put(c, "roof", new THREE.BoxGeometry(s.w + 0.4, 0.14, s.d + 0.4), s.roofCol, 0, h, 0, 2.4);
  } else {
    put(c, "wall", new THREE.BoxGeometry(s.w + 0.3, 0.6, s.d + 0.3), s.wallCol, 0, h + 0.3, 0);
  }
  const frontZ = hd;
  // doorway on the front (+z) and a second entrance on the back for larger houses
  const doorX = (rng.next() - 0.5) * Math.max(0, s.w - 2.4);
  addDoor(c, doorX, 0, frontZ);
  // window trim sills on the front face
  if (s.wallH > 6) put(c, "trim", new THREE.BoxGeometry(s.w * 0.8, 0.15, 0.3), 0x8c8170, 0, 0.5, frontZ + 0.1);
  // awning for shops
  if (s.shape === "shop") {
    put(c, "roof", new THREE.BoxGeometry(s.w * 0.8, 0.12, 1.6), 0x7a3b2a, 0, 2.6, frontZ + 0.7, 2.4);
    put(c, "trim", new THREE.BoxGeometry(s.w * 0.8, 0.5, 0.16), 0x5b3322, 0, 2.3, frontZ + 1.5);
  }
  // flower boxes in timber/plaster style
  if (s.style === "timber" || s.style === "plaster") {
    if (rng.next() < 0.6) put(c, "trim", new THREE.BoxGeometry(1.4, 0.3, 0.3), 0x5a3a24, 0, 1.2, frontZ + 0.2);
  }
  if (s.chimney) {
    const cx = ridgeZ ? hw * 0.5 : hd * 0.5;
    addChimney(c, cx, h + (s.roof === "hip" ? roofH * 0.6 : roofH * 0.45), ridgeZ ? -hd * 0.45 : -hw * 0.45, 2.2 + rng.next() * 1.4);
  }
  void hw;
}

function buildChurch(c: Ctx) {
  const { s } = c;
  const h = s.wallH;
  put(c, "wall", new THREE.BoxGeometry(s.w, h, s.d), s.wallCol, 0, h / 2, 0);
  const roofH = s.w * 0.45;
  const { roof, gables } = gableParts(s.w, s.d, roofH, true);
  for (const p of roof) putPoly(c, "roof", [p.map((q) => V(q.x, q.y + h, q.z))], V(0, h, 0), s.roofCol);
  for (const p of gables) putPoly(c, "wall", [p.map((q) => V(q.x, q.y + h, q.z))], V(0, h, 0), s.wallCol);
  // bell tower at the front (+z)
  const tw = Math.max(4.5, s.w * 0.36);
  const th = h + 16;
  const tz = s.d / 2 - tw / 2;
  put(c, "wall", new THREE.BoxGeometry(tw, th, tw), s.wallCol, 0, th / 2, tz);
  // lancet windows and belfry openings in the tower
  put(c, "trim", new THREE.BoxGeometry(tw * 0.5, 2.3, 0.2), 0x2c3a4a, 0, th - 5, tz + tw / 2 + 0.05);
  put(c, "trim", new THREE.BoxGeometry(tw * 0.5, 2.3, 0.2), 0x2c3a4a, 0, th - 5, tz - tw / 2 - 0.05);
  // spire
  const spire = new THREE.ConeGeometry(tw * 0.55, 15, 4, 1).rotateY(Math.PI / 4);
  put(c, "roof", spire, 0x3d434b, 0, th + 7.5, tz);
  put(c, "trim", new THREE.BoxGeometry(0.25, 2.2, 0.25), 0xd6c08a, 0, th + 16, tz); // cross
  put(c, "trim", new THREE.BoxGeometry(1.0, 0.25, 0.25), 0xd6c08a, 0, th + 15.2, tz);
  // rose window & portal
  put(c, "trim", new THREE.CircleGeometry(1.4, 12), 0x2c3a4a, 0, h * 0.7, s.d / 2 + 0.05);
  put(c, "trim", new THREE.BoxGeometry(2.4, 3.6, 0.25), 0x6b5d4a, 0, 1.8, -s.d / 2 + 0.05);
}

function buildPalace(c: Ctx) {
  const { s, rng } = c;
  const h = s.wallH;
  put(c, "wall", new THREE.BoxGeometry(s.w, h, s.d), s.wallCol, 0, h / 2, 0);
  // central cupola
  const dome = new THREE.SphereGeometry(Math.min(s.w, s.d) * 0.22, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  put(c, "roof", dome, 0x4c6b78, 0, h, 0);
  put(c, "wall", new THREE.CylinderGeometry(s.w * 0.1, s.w * 0.12, 3, 14), s.wallCol, 0, h + 1.5, 0);
  // hipped roof over the wings
  for (const poly of hipParts(s.w, s.d, 6)) putPoly(c, "roof", [poly.map((p) => V(p.x, p.y + h, p.z))], V(0, h, 0), s.roofCol);
  // four corner towers with conical roofs
  const tr = 6.2;
  const th = h + 14;
  for (const [sx, sz] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ]) {
    const tx = sx * (s.w / 2 - 2);
    const tz = sz * (s.d / 2 - 2);
    put(c, "wall", new THREE.CylinderGeometry(tr, tr + 0.4, th, 12), s.wallCol, tx, th / 2, tz);
    put(c, "roof", new THREE.ConeGeometry(tr + 1.2, 13, 12), 0x4c6b78, tx, th + 6.5, tz);
    put(c, "trim", new THREE.BoxGeometry(0.2, 3.6, 0.2), 0xd6c08a, tx, th + 14.4, tz); // spire tip
  }
  // grand gate and windows on the front
  put(c, "trim", new THREE.BoxGeometry(5.5, 6, 0.3), 0x3f3832, 0, 3, s.d / 2 + 0.02);
  for (let i = 0; i < 4; i++) {
    const x = (i - 1.5) * (s.w / 5.2);
    put(c, "trim", new THREE.BoxGeometry(1.1, 2.4, 0.18), 0x2c3a4a, x, h * 0.55, s.d / 2 + 0.1);
  }
  void rng;
}

function buildTower(c: Ctx) {
  const { s } = c;
  const h = s.wallH;
  put(c, "wall", new THREE.BoxGeometry(s.w, h, s.d), s.wallCol, 0, h / 2, 0);
  // stone pyramid roof
  const r = Math.max(s.w, s.d) * 0.72;
  put(c, "roof", new THREE.ConeGeometry(r, r * 0.8, 4, 1).rotateY(Math.PI / 4), s.roofCol, 0, h + r * 0.4, 0);
  put(c, "trim", new THREE.BoxGeometry(s.w + 0.6, 0.6, s.d + 0.6), 0x8e897c, 0, h - 0.2, 0);
  // arrow loops
  for (let f = 1; f < 3; f++) {
    put(c, "trim", new THREE.BoxGeometry(0.3, 1.4, 0.2), 0x26231f, 0, f * h / 3, s.d / 2 + 0.05);
    put(c, "trim", new THREE.BoxGeometry(0.3, 1.4, 0.2), 0x26231f, s.w / 2 + 0.05, f * h / 3, 0);
  }
}

function buildGatehouse(c: Ctx) {
  // A wall-spanning gatehouse: massive block on the wall, twin towers, an arched gate.
  const { s } = c;
  const h = s.wallH;
  put(c, "wall", new THREE.BoxGeometry(s.w, h, s.d), s.wallCol, 0, h / 2, 0);
  for (const sx of [-1, 1]) {
    const tx = sx * (s.w / 2 - 3.5);
    put(c, "wall", new THREE.CylinderGeometry(3.6, 3.8, h + 14, 12), s.wallCol, tx, (h + 14) / 2, s.d / 2 - 1);
    put(c, "roof", new THREE.ConeGeometry(4.2, 7, 12), s.roofCol, tx, h + 17.5, s.d / 2 - 1);
  }
  // gate arch (dark) and iron portcullis bars
  put(c, "trim", new THREE.BoxGeometry(s.w * 0.42, 9, 0.3), 0x2a241d, 0, 4.5, s.d / 2 + 0.03);
  for (let i = -2; i <= 2; i++) put(c, "trim", new THREE.BoxGeometry(0.14, 9, 0.2), 0x4a4a4a, i * (s.w * 0.1), 4.5, s.d / 2 + 0.1);
  // banner-style roof block
  put(c, "roof", new THREE.BoxGeometry(s.w + 1.4, 1.6, s.d + 1.4), s.roofCol, 0, h + 0.8, 0);
}

function buildMill(c: Ctx) {
  const { s } = c;
  put(c, "wall", new THREE.CylinderGeometry(s.w / 2, s.w / 2 + 0.6, 9, 12), s.wallCol, 0, 4.5, 0);
  put(c, "roof", new THREE.ConeGeometry(s.w / 2 + 1.5, 6, 12), s.roofCol, 0, 12, 0);
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    const sail = new THREE.BoxGeometry(0.4, 9.5, 0.6);
    sail.rotateZ(a);
    put(c, "trim", sail, 0xcfc4ad, Math.cos(a) * 0.1, 9.3 + Math.sin(a) * 0.1, s.w / 2 + 0.6);
  }
}

function buildBarn(c: Ctx) {
  const { s } = c;
  const h = s.wallH;
  put(c, "wall", new THREE.BoxGeometry(s.w, h, s.d), s.wallCol, 0, h / 2, 0);
  const roofH = s.w * 0.55;
  const { roof, gables } = gableParts(s.w, s.d, roofH, true);
  for (const p of roof) putPoly(c, "roof", [p.map((q) => V(q.x, q.y + h, q.z))], V(0, h, 0), s.roofCol);
  for (const p of gables) putPoly(c, "wall", [p.map((q) => V(q.x, q.y + h, q.z))], V(0, h, 0), s.wallCol);
  put(c, "trim", new THREE.BoxGeometry(s.w * 0.5, h * 0.8, 0.2), 0x4a3426, 0, h * 0.4, s.d / 2 + 0.05);
}

function buildRuin(c: Ctx) {
  const { s, rng } = c;
  const h = s.wallH * (0.25 + rng.next() * 0.45);
  put(c, "wall", new THREE.BoxGeometry(s.w, h, s.d), s.wallCol, 0, h / 2, 0);
  // rubble at base
  for (let i = 0; i < 6; i++)
    put(c, "wall", new THREE.BoxGeometry(0.8 + rng.next(), 0.5 + rng.next() * 0.4, 0.8 + rng.next()), s.wallCol, (rng.next() - 0.5) * s.w * 1.2, 0.3, (rng.next() - 0.5) * s.d * 1.2);
}

/** Builds (or rebuilds) the merged parts of one building. Coordinates are world space. */
export function buildParts(s: BuildingSpec): Bucket {
  const out: Bucket = { wall: { plaster: [], timber: [], stone: [], farm: [] }, roof: [], trim: [] };
  const xf = new THREE.Matrix4().compose(_v.set(s.x, 0, s.z), _q.setFromAxisAngle(V(0, 1, 0), s.yaw), V(1, 1, 1));
  const c: Ctx = { s, xf, out, rng: new RNG(s.seed), wallMat: wallMatOf(s.style) };
  switch (s.shape) {
    case "house":
    case "hip":
    case "shop":
      buildHouse(c);
      break;
    case "church":
      buildChurch(c);
      break;
    case "palace":
      buildPalace(c);
      break;
    case "tower":
      buildTower(c);
      break;
    case "gatehouse":
      buildGatehouse(c);
      break;
    case "barn":
      buildBarn(c);
      break;
    case "mill":
      buildMill(c);
      break;
    case "ruin":
      buildRuin(c);
      break;
  }
  return out;
}

// ----------------------------------------------------------------------------- chunked meshes
interface Cell {
  specs: BuildingSpec[];
  meshes: THREE.Mesh[];
  dirty: boolean;
  parts: Map<number, Bucket>;
}

/**
 * Buildings are grouped into square chunks. Each chunk is merged into a handful of meshes
 * (one per wall material, plus roofs and trim) so the scene stays at a few hundred draw calls
 * even with thousands of buildings. A destroyed building marks its chunk dirty and the chunk
 * is re-merged on the next flush.
 */
export class BuildingChunks {
  readonly group = new THREE.Group();
  private cells = new Map<number, Cell>();
  private dirtyQueue: number[] = [];
  readonly size: number;
  private half: number;
  private cols: number;

  constructor(specs: BuildingSpec[], size: number, half: number) {
    this.size = size;
    this.half = half;
    this.cols = Math.ceil((half * 2) / size);
    for (const s of specs) {
      const k = this.keyOf(s.x, s.z);
      let cell = this.cells.get(k);
      if (!cell) this.cells.set(k, (cell = { specs: [], meshes: [], dirty: true, parts: new Map() }));
      cell.specs.push(s);
      cell.parts.set(s.id, buildParts(s));
    }
    for (const k of this.cells.keys()) this.dirtyQueue.push(k);
  }

  private keyOf(x: number, z: number) {
    const cx = Math.min(this.cols - 1, Math.max(0, Math.floor((x + this.half) / this.size)));
    const cz = Math.min(this.cols - 1, Math.max(0, Math.floor((z + this.half) / this.size)));
    return cz * this.cols + cx;
  }

  markDirty(s: BuildingSpec) {
    const k = this.keyOf(s.x, s.z);
    const cell = this.cells.get(k);
    if (!cell) return;
    cell.dirty = true;
    if (!this.dirtyQueue.includes(k)) this.dirtyQueue.push(k);
  }

  /** Re-merge up to `budget` dirty chunks. Returns the number rebuilt. */
  flush(budget = 3) {
    let n = 0;
    while (this.dirtyQueue.length && n < budget) {
      const k = this.dirtyQueue.shift()!;
      const cell = this.cells.get(k);
      if (!cell || !cell.dirty) continue;
      cell.dirty = false;
      this.rebuild(cell);
      n++;
    }
    return n;
  }

  /** Build every dirty chunk synchronously (startup). */
  buildAll() {
    while (this.flush(64) > 0);
  }

  get pending() {
    return this.dirtyQueue.length;
  }

  private rebuild(cell: Cell) {
    const mats = buildingMaterials();
    const walls: Record<WallMat, THREE.BufferGeometry[]> = { plaster: [], timber: [], stone: [], farm: [] };
    const roofs: THREE.BufferGeometry[] = [];
    const trims: THREE.BufferGeometry[] = [];
    for (const s of cell.specs) {
      if (!s.alive) continue;
      const p = cell.parts.get(s.id);
      if (!p) continue;
      for (const k of Object.keys(walls) as WallMat[]) walls[k].push(...p.wall[k]);
      roofs.push(...p.roof);
      trims.push(...p.trim);
    }
    for (const m of cell.meshes) {
      this.group.remove(m);
      m.geometry.dispose();
    }
    cell.meshes = [];
    const add = (list: THREE.BufferGeometry[], mat: THREE.Material) => {
      if (!list.length) return;
      const merged = mergeGeometries(list, false) ?? new THREE.BufferGeometry();
      list.forEach((g) => g.dispose());
      const m = new THREE.Mesh(merged, mat);
      m.castShadow = true;
      m.receiveShadow = true;
      this.group.add(m);
      cell.meshes.push(m);
    };
    add(walls.plaster, mats.plaster);
    add(walls.timber, mats.timber);
    add(walls.stone, mats.stone);
    add(walls.farm, mats.farm);
    add(roofs, mats.roof);
    add(trims, mats.trim);
  }
}
