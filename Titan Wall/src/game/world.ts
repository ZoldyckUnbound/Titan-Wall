import * as THREE from "three";
import { RNG, clamp } from "./math";
import { NavGrid } from "./nav";
import { loaded, instantiateByBox } from "./assets";
import type { RayHit } from "./types";

export interface Box {
  min: THREE.Vector3;
  max: THREE.Vector3;
  kind: "building" | "wall" | "tower";
}
export interface Depot {
  pos: THREE.Vector3;
  radius: number;
}
export interface Contact {
  impact: number;
  normal: THREE.Vector3;
  grounded: boolean;
  touching: boolean;
  box: Box | null;
}
export const newContact = (): Contact => ({
  impact: 0,
  normal: new THREE.Vector3(),
  grounded: false,
  touching: false,
  box: null,
});

let _nx = 0;
let _ny = 0;
let _nz = 0;
/** Ray vs AABB slab test. Returns entry distance or -1. Writes the hit normal to _nx/_ny/_nz. */
function rayBox(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, b: Box, maxT: number) {
  let tmin = 0;
  let tmax = maxT;
  let nx = 0;
  let ny = 0;
  let nz = 0;
  // X
  if (Math.abs(dx) < 1e-9) {
    if (ox < b.min.x || ox > b.max.x) return -1;
  } else {
    let t1 = (b.min.x - ox) / dx;
    let t2 = (b.max.x - ox) / dx;
    if (t1 > t2) [t1, t2] = [t2, t1];
    if (t1 > tmin) {
      tmin = t1;
      nx = dx > 0 ? -1 : 1;
      ny = 0;
      nz = 0;
    }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  // Y
  if (Math.abs(dy) < 1e-9) {
    if (oy < b.min.y || oy > b.max.y) return -1;
  } else {
    let t1 = (b.min.y - oy) / dy;
    let t2 = (b.max.y - oy) / dy;
    if (t1 > t2) [t1, t2] = [t2, t1];
    if (t1 > tmin) {
      tmin = t1;
      ny = dy > 0 ? -1 : 1;
      nx = 0;
      nz = 0;
    }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  // Z
  if (Math.abs(dz) < 1e-9) {
    if (oz < b.min.z || oz > b.max.z) return -1;
  } else {
    let t1 = (b.min.z - oz) / dz;
    let t2 = (b.max.z - oz) / dz;
    if (t1 > t2) [t1, t2] = [t2, t1];
    if (t1 > tmin) {
      tmin = t1;
      nz = dz > 0 ? -1 : 1;
      nx = 0;
      ny = 0;
    }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  if (nx === 0 && ny === 0 && nz === 0) return -1; // origin inside
  _nx = nx;
  _ny = ny;
  _nz = nz;
  return tmin;
}

function canvasTex(w: number, h: number, rx: number, ry: number, draw: (c: CanvasRenderingContext2D) => void) {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  draw(ctx);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function stoneTex(rx: number, ry: number) {
  return canvasTex(256, 256, rx, ry, (g) => {
    g.fillStyle = "#8d897f";
    g.fillRect(0, 0, 256, 256);
    const rows = 8;
    const rh = 256 / rows;
    for (let r = 0; r < rows; r++) {
      const cols = 4;
      const cw = 256 / cols;
      const off = r % 2 ? cw / 2 : 0;
      for (let c = -1; c <= cols; c++) {
        const v = 120 + Math.floor(Math.random() * 40);
        g.fillStyle = `rgb(${v},${v - 4},${v - 10})`;
        g.fillRect(c * cw + off + 2, r * rh + 2, cw - 4, rh - 4);
      }
    }
  });
}
function cobbleTex(rx: number, ry: number) {
  return canvasTex(256, 256, rx, ry, (g) => {
    g.fillStyle = "#4b4843";
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 260; i++) {
      const v = 80 + Math.floor(Math.random() * 60);
      g.fillStyle = `rgb(${v},${v - 3},${v - 8})`;
      g.beginPath();
      g.ellipse(Math.random() * 256, Math.random() * 256, 9 + Math.random() * 6, 7 + Math.random() * 4, Math.random(), 0, 7);
      g.fill();
    }
  });
}
function grassTex(rx: number, ry: number) {
  return canvasTex(128, 128, rx, ry, (g) => {
    g.fillStyle = "#4c6b3a";
    g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 700; i++) {
      const v = Math.floor(Math.random() * 40);
      g.fillStyle = `rgb(${60 + v},${95 + v},${45 + v / 2})`;
      g.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
    }
  });
}
function plasterTex() {
  return canvasTex(128, 128, 1, 1, (g) => {
    g.fillStyle = "#f0ece2";
    g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 500; i++) {
      const v = 200 + Math.floor(Math.random() * 40);
      g.fillStyle = `rgba(${v},${v - 6},${v - 18},0.5)`;
      g.fillRect(Math.random() * 128, Math.random() * 128, 3, 3);
    }
    g.fillStyle = "rgba(70,50,35,0.55)";
    g.fillRect(0, 0, 128, 5);
    g.fillRect(0, 123, 128, 5);
    g.fillRect(0, 0, 5, 128);
    g.fillRect(123, 0, 5, 128);
  });
}

export class World {
  readonly group = new THREE.Group();
  readonly boxes: Box[] = [];
  readonly depots: Depot[] = [];
  readonly half = 110;
  readonly bound = 150;
  nav!: NavGrid;
  playerSpawn = new THREE.Vector3(0, 1, -100);
  private rng: RNG;

  constructor(seed = 1337) {
    this.rng = new RNG(seed);
    this.build();
  }

  // ------------------------------------------------------------------ geometry queries
  raycast(o: THREE.Vector3, d: THREE.Vector3, maxDist: number): RayHit | null {
    let bestT = maxDist;
    let bestBox: Box | null = null;
    let nx = 0;
    let ny = 0;
    let nz = 0;
    let hit = false;
    for (const b of this.boxes) {
      const t = rayBox(o.x, o.y, o.z, d.x, d.y, d.z, b, bestT);
      if (t >= 0 && t < bestT) {
        bestT = t;
        bestBox = b;
        nx = _nx;
        ny = _ny;
        nz = _nz;
        hit = true;
      }
    }
    if (d.y < -1e-5 && o.y > 0) {
      const t = -o.y / d.y;
      if (t >= 0 && t < bestT) {
        bestT = t;
        bestBox = null;
        nx = 0;
        ny = 1;
        nz = 0;
        hit = true;
      }
    }
    if (!hit) return null;
    return {
      dist: bestT,
      point: new THREE.Vector3(o.x + d.x * bestT, o.y + d.y * bestT, o.z + d.z * bestT),
      normal: new THREE.Vector3(nx, ny, nz),
      kind: bestBox ? "box" : "ground",
      box: bestBox ?? undefined,
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
    for (const bx of this.boxes) {
      const t = rayBox(a.x, a.y, a.z, ix, iy, iz, bx, len);
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
    for (const b of this.boxes) {
      if (
        pos.x < b.min.x - r ||
        pos.x > b.max.x + r ||
        pos.y < b.min.y - r ||
        pos.y > b.max.y + r ||
        pos.z < b.min.z - r ||
        pos.z > b.max.z + r
      )
        continue;
      const qx = clamp(pos.x, b.min.x, b.max.x);
      const qy = clamp(pos.y, b.min.y, b.max.y);
      const qz = clamp(pos.z, b.min.z, b.max.z);
      const dx = pos.x - qx;
      const dy = pos.y - qy;
      const dz = pos.z - qz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= r * r) continue;
      let nx: number;
      let ny: number;
      let nz: number;
      let pen: number;
      if (d2 > 1e-10) {
        const d = Math.sqrt(d2);
        nx = dx / d;
        ny = dy / d;
        nz = dz / d;
        pen = r - d;
      } else {
        const opts: [number, number, number, number][] = [
          [pos.x - b.min.x, -1, 0, 0],
          [b.max.x - pos.x, 1, 0, 0],
          [pos.y - b.min.y, 0, -1, 0],
          [b.max.y - pos.y, 0, 1, 0],
          [pos.z - b.min.z, 0, 0, -1],
          [b.max.z - pos.z, 0, 0, 1],
        ];
        opts.sort((p, q) => p[0] - q[0]);
        pen = opts[0][0] + r;
        nx = opts[0][1];
        ny = opts[0][2];
        nz = opts[0][3];
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

  // ------------------------------------------------------------------ construction
  private addBox(x: number, z: number, w: number, d: number, top: number, kind: Box["kind"]) {
    this.boxes.push({
      min: new THREE.Vector3(x - w / 2, 0, z - d / 2),
      max: new THREE.Vector3(x + w / 2, top, z + d / 2),
      kind,
    });
  }

  private build() {
    const rng = this.rng;
    const g = this.group;

    // --- terrain
    const grassT = grassTex(120, 120);
    const grass = new THREE.Mesh(
      new THREE.PlaneGeometry(2400, 2400),
      new THREE.MeshStandardMaterial({ color: grassT ? 0xffffff : 0x587a43, ...(grassT ? { map: grassT } : {}), roughness: 1 })
    );
    grass.rotation.x = -Math.PI / 2;
    grass.position.y = -0.03;
    grass.receiveShadow = true;
    g.add(grass);

    const cobT = cobbleTex(38, 38);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(222, 222),
      new THREE.MeshStandardMaterial({ color: cobT ? 0xffffff : 0x6c6860, ...(cobT ? { map: cobT } : {}), roughness: 0.95 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    g.add(floor);

    // distant hills for atmosphere
    const hillMat = new THREE.MeshStandardMaterial({ color: 0x5f7a66, roughness: 1, flatShading: true });
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2 + rng.next() * 0.2;
      const r = 520 + rng.next() * 260;
      const h = 70 + rng.next() * 150;
      const hill = new THREE.Mesh(new THREE.ConeGeometry(120 + rng.next() * 120, h, 7), hillMat);
      hill.position.set(Math.cos(a) * r, h / 2 - 4, Math.sin(a) * r);
      g.add(hill);
    }

    // --- walls
    const H = this.half;
    const wallH = 32;
    const wallDefs: [number, number, number, number][] = [
      [0, H + 4, 244, 8],
      [0, -H - 4, 244, 8],
      [H + 4, 0, 8, 220],
      [-H - 4, 0, 8, 220],
    ];
    for (const [x, z, w, d] of wallDefs) {
      this.addBox(x, z, w, d, wallH, "wall");
      const long = Math.max(w, d);
      const tex = stoneTex(long / 9, wallH / 5);
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(w, wallH, d),
        new THREE.MeshStandardMaterial({ color: tex ? 0xffffff : 0x8b877d, ...(tex ? { map: tex } : {}), roughness: 0.95 })
      );
      m.position.set(x, wallH / 2, z);
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
    }
    // battlements
    const merlons: THREE.Matrix4[] = [];
    const mm = new THREE.Matrix4();
    for (let t = -120; t <= 120; t += 4.6) {
      for (const s of [-1, 1]) {
        mm.makeTranslation(t, wallH + 1.1, s * (H + 0.9));
        merlons.push(mm.clone());
        mm.makeTranslation(t, wallH + 1.1, s * (H + 7.1));
        merlons.push(mm.clone());
      }
    }
    for (let t = -108; t <= 108; t += 4.6) {
      for (const s of [-1, 1]) {
        mm.makeTranslation(s * (H + 0.9), wallH + 1.1, t);
        merlons.push(mm.clone());
        mm.makeTranslation(s * (H + 7.1), wallH + 1.1, t);
        merlons.push(mm.clone());
      }
    }
    const merlonMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(2.6, 2.2, 1.6),
      new THREE.MeshStandardMaterial({ color: 0x8f8b81, roughness: 0.95 }),
      merlons.length
    );
    merlons.forEach((m, i) => merlonMesh.setMatrixAt(i, m));
    merlonMesh.castShadow = true;
    g.add(merlonMesh);

    // --- town blocks
    const plaster = plasterTex();
    const plasterColors = [0xf2ead8, 0xe4d3b0, 0xd6c6a8, 0xe9dcc2, 0xc9b79a, 0xdcd3c3];
    const roofColors = [0x8a3b2c, 0x7a3326, 0x4d525b, 0x5e4a3a, 0x6f3a2c, 0x934836];
    const roofGeo = new THREE.ConeGeometry(1, 1, 4, 1).rotateY(Math.PI / 4);
    const spireGeo = new THREE.ConeGeometry(1, 1, 8, 1);
    const winMats: THREE.Matrix4[] = [];
    const winCols: THREE.Color[] = [];
    const wm = new THREE.Matrix4();
    const addWin = (x: number, y: number, z: number, sx: number, sz: number) => {
      wm.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(sx, 1.5, sz));
      winMats.push(wm.clone());
      const v = rng.next();
      winCols.push(new THREE.Color(v < 0.2 ? 0x8a7a50 : v < 0.6 ? 0x2c3a48 : 0x34424f));
    };

    const centers = [-75, -25, 25, 75];
    const plazaBlocks = new Set(["-25,25", "25,-25"]);
    const towerBlocks = new Map<string, number>([
      ["25,25", 1],
      ["-75,75", 2],
      ["75,-75", 3],
    ]);

    const makeBuilding = (cx: number, cz: number, w: number, d: number, floors: number, tower: boolean) => {
      const h = floors * 3.4 + 0.4;
      const roofH = tower ? 11 : Math.min(w, d) * 0.2;
      const colorP = rng.pick(plasterColors);
      const colorR = tower ? 0x3f4650 : rng.pick(roofColors);
      const grp = new THREE.Group();
      grp.position.set(cx, 0, cz);

      const useAsset = loaded.buildings.length > 0 && !tower;
      if (useAsset) {
        const inst = instantiateByBox(rng.pick(loaded.buildings), w, h + roofH, d);
        grp.add(inst);
      } else {
        const bodyMat = new THREE.MeshStandardMaterial({
          color: tower ? 0xbdb6a6 : colorP,
          ...(plaster ? { map: plaster } : {}),
          roughness: 0.92,
        });
        const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), bodyMat);
        body.position.y = h / 2;
        body.castShadow = true;
        body.receiveShadow = true;
        grp.add(body);
        const roof = new THREE.Mesh(
          tower ? spireGeo : roofGeo,
          new THREE.MeshStandardMaterial({ color: colorR, roughness: 0.8 })
        );
        if (tower) roof.scale.set(w * 0.78, roofH, d * 0.78);
        else roof.scale.set((w / 2 + 0.7) * Math.SQRT2, roofH, (d / 2 + 0.7) * Math.SQRT2);
        roof.position.y = h + roofH / 2;
        roof.castShadow = true;
        grp.add(roof);
        if (!tower && rng.next() < 0.55) {
          const ch = new THREE.Mesh(
            new THREE.BoxGeometry(1.1, 3, 1.1),
            new THREE.MeshStandardMaterial({ color: 0x6a5a50, roughness: 1 })
          );
          ch.position.set(w * 0.25, h + roofH * 0.6, d * 0.15);
          ch.castShadow = true;
          grp.add(ch);
        }
        // windows
        for (let f = 0; f < floors; f++) {
          const y = 2.0 + f * 3.4;
          const colsZ = Math.max(1, Math.floor(w / 4.2));
          const colsX = Math.max(1, Math.floor(d / 4.2));
          for (let c = 0; c < colsZ; c++) {
            const off = ((c + 0.5) / colsZ - 0.5) * w;
            addWin(cx + off, y, cz + d / 2 + 0.03, 1.1, 0.2);
            addWin(cx + off, y, cz - d / 2 - 0.03, 1.1, 0.2);
          }
          for (let c = 0; c < colsX; c++) {
            const off = ((c + 0.5) / colsX - 0.5) * d;
            addWin(cx + w / 2 + 0.03, y, cz + off, 0.2, 1.1);
            addWin(cx - w / 2 - 0.03, y, cz + off, 0.2, 1.1);
          }
        }
      }
      g.add(grp);
      this.addBox(cx, cz, w, d, h + (tower ? 2 : roofH * 0.35), tower ? "tower" : "building");
    };

    for (const bx of centers)
      for (const bz of centers) {
        const key = `${bx},${bz}`;
        if (plazaBlocks.has(key)) continue;
        if (towerBlocks.has(key)) {
          makeBuilding(bx, bz, 13, 13, 8, true);
          // a few low houses around the tower
          for (const [ox, oz] of [
            [-12, -12],
            [12, 12],
          ])
            makeBuilding(bx + ox, bz + oz, 10, 10, 2, false);
          continue;
        }
        for (const ox of [-9, 9])
          for (const oz of [-9, 9]) {
            if (rng.next() < 0.08) continue;
            const w = rng.range(11, 16);
            const d = rng.range(11, 16);
            const floors = 2 + Math.floor(rng.next() * 3);
            makeBuilding(bx + ox + rng.range(-0.6, 0.6), bz + oz + rng.range(-0.6, 0.6), w, d, floors, false);
          }
      }

    if (winMats.length) {
      const wins = new THREE.InstancedMesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0.1 }),
        winMats.length
      );
      winMats.forEach((m, i) => {
        wins.setMatrixAt(i, m);
        wins.setColorAt(i, winCols[i]);
      });
      g.add(wins);
    }

    // --- plaza fountains
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x9a968c, roughness: 0.9 });
    const waterMat = new THREE.MeshStandardMaterial({ color: 0x4a8fb5, roughness: 0.15, metalness: 0.2 });
    for (const [fx, fz] of [
      [-25, 25],
      [25, -25],
    ]) {
      const basin = new THREE.Mesh(new THREE.CylinderGeometry(7, 7.5, 1.2, 20), stoneMat);
      basin.position.set(fx, 0.6, fz);
      basin.receiveShadow = true;
      basin.castShadow = true;
      const water = new THREE.Mesh(new THREE.CylinderGeometry(6.3, 6.3, 0.2, 20), waterMat);
      water.position.set(fx, 1.1, fz);
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.1, 5, 10), stoneMat);
      col.position.set(fx, 3, fz);
      col.castShadow = true;
      g.add(basin, water, col);
      this.addBox(fx, fz, 14, 14, 1.3, "building");
    }

    // --- supply depots (gas + blades + medic)
    const crateMat = new THREE.MeshStandardMaterial({ color: 0x8a6a3f, roughness: 0.9 });
    const barrelMat = new THREE.MeshStandardMaterial({ color: 0x5b4a3a, roughness: 0.8 });
    const flagMat = new THREE.MeshStandardMaterial({ color: 0x2f6b3c, roughness: 0.8, side: THREE.DoubleSide });
    const beaconMat = new THREE.MeshBasicMaterial({
      color: 0x59e0ff,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    for (const [dx, dz] of [
      [-75, -50],
      [75, 50],
      [25, -50],
      [-25, 50],
    ]) {
      const dep = new THREE.Group();
      dep.position.set(dx, 0, dz);
      for (const [ox, oz, s] of [
        [-1.4, 0, 1.6],
        [0.4, 0.2, 1.3],
        [-0.5, 1.6, 1.1],
      ] as [number, number, number][]) {
        const c = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), crateMat);
        c.position.set(ox, s / 2, oz);
        c.castShadow = true;
        dep.add(c);
      }
      for (const [ox, oz] of [
        [1.8, -0.4],
        [2.3, 0.7],
      ]) {
        const b = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.2, 10), barrelMat);
        b.position.set(ox, 0.6, oz);
        b.castShadow = true;
        dep.add(b);
      }
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 6, 6), crateMat);
      pole.position.set(-2.4, 3, -1);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.3), flagMat);
      flag.position.set(-1.3, 5.2, -1);
      const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 16, 14, 1, true), beaconMat);
      beacon.position.y = 8;
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(4.4, 5, 32),
        new THREE.MeshBasicMaterial({ color: 0x59e0ff, transparent: true, opacity: 0.5, side: THREE.DoubleSide })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.06;
      dep.add(pole, flag, beacon, ring);
      g.add(dep);
      this.depots.push({ pos: new THREE.Vector3(dx, 0, dz), radius: 5 });
    }

    this.nav = new NavGrid(this.boxes);
  }
}
