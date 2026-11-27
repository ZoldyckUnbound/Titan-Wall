import * as THREE from "three";

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
 * Coarse 2D navigation grid over the whole map. Each cell stores the tallest solid in it.
 * Walkers (titans) treat anything above ~0.5 m as blocked; the cells are re-computed when a
 * building collapses so titans can path through the rubble.
 */
export class NavGrid {
  readonly cell: number;
  readonly n: number;
  readonly origin: number;
  height: Float32Array;
  private g: Float32Array;
  private parent: Int32Array;
  private stamp: Int32Array;
  private closed: Uint8Array;
  private curStamp = 0;
  private heap = new MinHeap();

  constructor(halfExtent: number, cell = 20) {
    this.cell = cell;
    this.n = Math.ceil((halfExtent * 2) / cell);
    this.origin = -halfExtent;
    const N = this.n * this.n;
    this.height = new Float32Array(N);
    this.g = new Float32Array(N);
    this.parent = new Int32Array(N);
    this.stamp = new Int32Array(N);
    this.closed = new Uint8Array(N);
  }

  cx(v: number) {
    return Math.max(0, Math.min(this.n - 1, Math.floor((v - this.origin) / this.cell)));
  }
  center(i: number) {
    return this.origin + (i + 0.5) * this.cell;
  }
  /** Cell index range covering [a,b] along one axis. */
  range(a: number, b: number): [number, number] {
    return [this.cx(a), this.cx(b)];
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
    for (let r = 1; r < 14; r++) {
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

  randomFree(maxH: number, infl: number, accept?: (x: number, z: number) => boolean, span = 0): THREE.Vector3 | null {
    for (let k = 0; k < 120; k++) {
      const ix = 4 + Math.floor(Math.random() * (this.n - 8));
      const iz = 4 + Math.floor(Math.random() * (this.n - 8));
      if (this.blocked(ix, iz, maxH, infl)) continue;
      const x = this.center(ix);
      const z = this.center(iz);
      if (span && Math.hypot(x, z) > span) continue;
      if (accept && !accept(x, z)) continue;
      return new THREE.Vector3(x, 0, z);
    }
    return null;
  }

  /** A* searches left this frame (see beginFrame). */
  private budget = 1e9;

  /** Reset the per-frame A* budget. Searches beyond it return null and are retried on a later frame. */
  beginFrame(searches = 3) {
    this.budget = searches;
  }

  /** A random free point in the annulus [r0, r1] around (cx, cz). */
  freeInRing(cx: number, cz: number, r0: number, r1: number, accept?: (x: number, z: number) => boolean, tries = 200): THREE.Vector3 | null {
    for (let k = 0; k < tries; k++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(r0 * r0 + Math.random() * (r1 * r1 - r0 * r0));
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      if (Math.abs(x) >= -this.origin || Math.abs(z) >= -this.origin) continue;
      if (this.blocked(this.cx(x), this.cx(z), 0.5, 1)) continue;
      if (accept && !accept(x, z)) continue;
      return new THREE.Vector3(x, 0, z);
    }
    return null;
  }

  findPath(from: THREE.Vector3, to: THREE.Vector3, maxH: number, infl: number, guard = 8000): THREE.Vector3[] | null {
    if (this.budget <= 0) return null;
    this.budget--;
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
    let steps = 0;
    while (heap.size > 0 && steps++ < guard) {
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
