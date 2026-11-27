import * as THREE from "three";
import type { Box } from "./world";

class MinHeap {
  keys: number[] = [];
  vals: number[] = [];
  get size() {
    return this.keys.length;
  }
  clear() {
    this.keys.length = 0;
    this.vals.length = 0;
  }
  push(k: number, v: number) {
    const K = this.keys;
    const Vv = this.vals;
    let i = K.length;
    K.push(k);
    Vv.push(v);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (K[p] <= K[i]) break;
      [K[p], K[i]] = [K[i], K[p]];
      [Vv[p], Vv[i]] = [Vv[i], Vv[p]];
      i = p;
    }
  }
  pop(): number {
    const K = this.keys;
    const Vv = this.vals;
    const top = Vv[0];
    const lk = K.pop()!;
    const lv = Vv.pop()!;
    if (K.length > 0) {
      K[0] = lk;
      Vv[0] = lv;
      let i = 0;
      const n = K.length;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < n && K[l] < K[m]) m = l;
        if (r < n && K[r] < K[m]) m = r;
        if (m === i) break;
        [K[m], K[i]] = [K[i], K[m]];
        [Vv[m], Vv[i]] = [Vv[i], Vv[m]];
        i = m;
      }
    }
    return top;
  }
}

/**
 * Coarse 2D navigation grid storing the tallest obstacle in each cell.
 * Walkers (titans) treat every building as blocked (maxH ~ 0); flyers (ODM scouts)
 * treat only buildings taller than their cruising altitude as blocked.
 */
export class NavGrid {
  readonly cell = 3;
  readonly n = 84;
  readonly origin = -126;
  height: Float32Array;
  private g: Float32Array;
  private parent: Int32Array;
  private stamp: Int32Array;
  private closed: Uint8Array;
  private curStamp = 0;
  private heap = new MinHeap();

  constructor(boxes: Box[]) {
    const N = this.n * this.n;
    this.height = new Float32Array(N);
    this.g = new Float32Array(N);
    this.parent = new Int32Array(N);
    this.stamp = new Int32Array(N);
    this.closed = new Uint8Array(N);
    for (const b of boxes) {
      const x0 = this.cx(b.min.x);
      const x1 = this.cx(b.max.x);
      const z0 = this.cx(b.min.z);
      const z1 = this.cx(b.max.z);
      for (let z = z0; z <= z1; z++)
        for (let x = x0; x <= x1; x++) {
          const i = z * this.n + x;
          if (b.max.y > this.height[i]) this.height[i] = b.max.y;
        }
    }
  }

  cx(v: number) {
    return Math.max(0, Math.min(this.n - 1, Math.floor((v - this.origin) / this.cell)));
  }
  center(i: number) {
    return this.origin + (i + 0.5) * this.cell;
  }

  blocked(ix: number, iz: number, maxH: number, infl: number) {
    for (let dz = -infl; dz <= infl; dz++)
      for (let dx = -infl; dx <= infl; dx++) {
        const x = ix + dx;
        const z = iz + dz;
        if (x < 0 || z < 0 || x >= this.n || z >= this.n) return true;
        if (this.height[z * this.n + x] > maxH) return true;
      }
    return false;
  }

  nearestFree(ix: number, iz: number, maxH: number, infl: number): [number, number] | null {
    if (!this.blocked(ix, iz, maxH, infl)) return [ix, iz];
    for (let r = 1; r < 24; r++) {
      let best: [number, number] | null = null;
      let bd = 1e9;
      for (let dz = -r; dz <= r; dz++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const x = ix + dx;
          const z = iz + dz;
          if (x < 0 || z < 0 || x >= this.n || z >= this.n) continue;
          if (this.blocked(x, z, maxH, infl)) continue;
          const d = dx * dx + dz * dz;
          if (d < bd) {
            bd = d;
            best = [x, z];
          }
        }
      if (best) return best;
    }
    return null;
  }

  /** True if a straight line between two cells never touches a blocked cell. */
  private los(ax: number, az: number, bx: number, bz: number, maxH: number, infl: number) {
    const dx = bx - ax;
    const dz = bz - az;
    const steps = Math.ceil(Math.max(Math.abs(dx), Math.abs(dz)) * 2);
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      const x = Math.round(ax + dx * t);
      const z = Math.round(az + dz * t);
      if (this.blocked(x, z, maxH, infl)) return false;
    }
    return true;
  }

  randomFree(maxH: number, infl: number, accept?: (x: number, z: number) => boolean): THREE.Vector3 | null {
    for (let k = 0; k < 80; k++) {
      const ix = 4 + Math.floor(Math.random() * (this.n - 8));
      const iz = 4 + Math.floor(Math.random() * (this.n - 8));
      if (this.blocked(ix, iz, maxH, infl)) continue;
      const x = this.center(ix);
      const z = this.center(iz);
      if (Math.abs(x) > 104 || Math.abs(z) > 104) continue;
      if (accept && !accept(x, z)) continue;
      return new THREE.Vector3(x, 0, z);
    }
    return null;
  }

  findPath(from: THREE.Vector3, to: THREE.Vector3, maxH: number, infl: number): THREE.Vector3[] | null {
    const sFree = this.nearestFree(this.cx(from.x), this.cx(from.z), maxH, infl);
    const gFree = this.nearestFree(this.cx(to.x), this.cx(to.z), maxH, infl);
    if (!sFree || !gFree) return null;
    const n = this.n;
    const start = sFree[1] * n + sFree[0];
    const goal = gFree[1] * n + gFree[0];
    this.curStamp++;
    const st = this.curStamp;
    const heap = this.heap;
    heap.clear();
    this.g[start] = 0;
    this.stamp[start] = st;
    this.parent[start] = -1;
    this.closed[start] = 0;
    heap.push(0, start);
    const gx = gFree[0];
    const gz = gFree[1];
    let found = false;
    let guard = 0;
    while (heap.size > 0 && guard++ < 9000) {
      const cur = heap.pop();
      if (this.stamp[cur] === st && this.closed[cur] === 2) continue;
      this.closed[cur] = 2;
      if (cur === goal) {
        found = true;
        break;
      }
      const cxi = cur % n;
      const czi = (cur / n) | 0;
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          const nx = cxi + dx;
          const nz = czi + dz;
          if (nx < 0 || nz < 0 || nx >= n || nz >= n) continue;
          if (this.blocked(nx, nz, maxH, infl)) continue;
          if (dx && dz && (this.blocked(cxi + dx, czi, maxH, infl) || this.blocked(cxi, czi + dz, maxH, infl))) continue;
          const ni = nz * n + nx;
          const ng = this.g[cur] + (dx && dz ? 1.414 : 1);
          if (this.stamp[ni] !== st) {
            this.stamp[ni] = st;
            this.closed[ni] = 0;
            this.g[ni] = 1e9;
          }
          if (ng < this.g[ni]) {
            this.g[ni] = ng;
            this.parent[ni] = cur;
            const ddx = Math.abs(nx - gx);
            const ddz = Math.abs(nz - gz);
            const h = Math.max(ddx, ddz) + 0.414 * Math.min(ddx, ddz);
            heap.push(ng + h * 1.05, ni);
          }
        }
    }
    if (!found) return null;
    const cells: number[] = [];
    for (let c = goal; c !== -1; c = this.parent[c]) cells.push(c);
    cells.reverse();
    // string-pull smoothing
    const out: THREE.Vector3[] = [];
    let anchor = 0;
    while (anchor < cells.length - 1) {
      let far = anchor + 1;
      const ax = cells[anchor] % n;
      const az = (cells[anchor] / n) | 0;
      for (let k = cells.length - 1; k > anchor + 1; k--) {
        const bx = cells[k] % n;
        const bz = (cells[k] / n) | 0;
        if (this.los(ax, az, bx, bz, maxH, infl)) {
          far = k;
          break;
        }
      }
      anchor = far;
      out.push(new THREE.Vector3(this.center(cells[far] % n), 0, this.center((cells[far] / n) | 0)));
    }
    return out;
  }
}
