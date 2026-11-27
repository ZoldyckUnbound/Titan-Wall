import * as THREE from "three";

/** Pooled soft-disc particles (steam, sparks, gas jets) rendered as a single Points draw call. */
export class Particles {
  readonly points: THREE.Points;
  private max: number;
  private posA: Float32Array;
  private colA: Float32Array;
  private sizeA: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private grav: Float32Array;
  private drag: Float32Array;
  private grow: Float32Array;
  private size0: Float32Array;
  private a0: Float32Array;
  private next = 0;
  private mat: THREE.ShaderMaterial;
  private geo: THREE.BufferGeometry;

  constructor(max = 2500) {
    this.max = max;
    this.posA = new Float32Array(max * 3);
    this.colA = new Float32Array(max * 4);
    this.sizeA = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max).fill(1);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.size0 = new Float32Array(max);
    this.a0 = new Float32Array(max);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute("position", new THREE.BufferAttribute(this.posA, 3));
    this.geo.setAttribute("color", new THREE.BufferAttribute(this.colA, 4));
    this.geo.setAttribute("size", new THREE.BufferAttribute(this.sizeA, 1));
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uScale: { value: 600 } },
      vertexShader: `
        attribute float size; attribute vec4 color; varying vec4 vColor; uniform float uScale;
        void main(){ vColor=color; vec4 mv=modelViewMatrix*vec4(position,1.0);
          gl_PointSize=size*uScale/max(0.5,-mv.z); gl_Position=projectionMatrix*mv; }`,
      fragmentShader: `
        varying vec4 vColor;
        void main(){ float d=length(gl_PointCoord-0.5); float a=smoothstep(0.5,0.05,d);
          if(a<0.01) discard; gl_FragColor=vec4(vColor.rgb, vColor.a*a); }`,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
  }

  setScale(s: number) {
    this.mat.uniforms.uScale.value = s;
  }

  emit(
    p: THREE.Vector3,
    v: THREE.Vector3,
    color: [number, number, number],
    alpha: number,
    size: number,
    life: number,
    grav = 0,
    drag = 0,
    grow = 0
  ) {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    this.posA[i * 3] = p.x;
    this.posA[i * 3 + 1] = p.y;
    this.posA[i * 3 + 2] = p.z;
    this.vel[i * 3] = v.x;
    this.vel[i * 3 + 1] = v.y;
    this.vel[i * 3 + 2] = v.z;
    this.colA[i * 4] = color[0];
    this.colA[i * 4 + 1] = color[1];
    this.colA[i * 4 + 2] = color[2];
    this.colA[i * 4 + 3] = alpha;
    this.a0[i] = alpha;
    this.size0[i] = size;
    this.sizeA[i] = size;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.grav[i] = grav;
    this.drag[i] = drag;
    this.grow[i] = grow;
  }

  update(dt: number) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) {
        this.sizeA[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const k = Math.max(0, this.life[i] / this.maxLife[i]);
      const dr = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= dr;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * dr - this.grav[i] * dt;
      this.vel[i * 3 + 2] *= dr;
      this.posA[i * 3] += this.vel[i * 3] * dt;
      this.posA[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.posA[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.colA[i * 4 + 3] = this.a0[i] * k;
      this.sizeA[i] = this.size0[i] * (1 + this.grow[i] * (1 - k));
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.geo.attributes.size.needsUpdate = true;
  }
}

const UP = new THREE.Vector3(0, 1, 0);

export class FX {
  readonly group = new THREE.Group();
  readonly particles = new Particles();
  private ropes: THREE.InstancedMesh;
  private ropeCount = 0;
  private tmpM = new THREE.Matrix4();
  private tmpQ = new THREE.Quaternion();
  private tmpV = new THREE.Vector3();
  private tmpS = new THREE.Vector3();
  private tmpD = new THREE.Vector3();
  private v = new THREE.Vector3();

  constructor(maxRopes = 16) {
    const geo = new THREE.CylinderGeometry(0.035, 0.035, 1, 5, 1);
    const mat = new THREE.MeshBasicMaterial({ color: 0xd9d4c4 });
    this.ropes = new THREE.InstancedMesh(geo, mat, maxRopes);
    this.ropes.frustumCulled = false;
    this.ropes.count = 0;
    this.group.add(this.ropes, this.particles.points);
  }

  beginRopes() {
    this.ropeCount = 0;
  }

  rope(a: THREE.Vector3, b: THREE.Vector3) {
    if (this.ropeCount >= this.ropes.instanceMatrix.count) return;
    this.tmpD.subVectors(b, a);
    const len = this.tmpD.length();
    if (len < 0.01) return;
    this.tmpD.divideScalar(len);
    this.tmpQ.setFromUnitVectors(UP, this.tmpD);
    this.tmpV.addVectors(a, b).multiplyScalar(0.5);
    this.tmpS.set(1, len, 1);
    this.tmpM.compose(this.tmpV, this.tmpQ, this.tmpS);
    this.ropes.setMatrixAt(this.ropeCount++, this.tmpM);
  }

  endRopes() {
    this.ropes.count = this.ropeCount;
    this.ropes.instanceMatrix.needsUpdate = true;
  }

  /** White titan steam / vapour burst. */
  steam(p: THREE.Vector3, amount: number, spread: number, rise = 6) {
    for (let i = 0; i < amount; i++) {
      this.v.set((Math.random() - 0.5) * spread, Math.random() * rise + 1, (Math.random() - 0.5) * spread);
      const q = this.tmpV.copy(p);
      q.x += (Math.random() - 0.5) * spread * 0.4;
      q.y += (Math.random() - 0.5) * spread * 0.3;
      q.z += (Math.random() - 0.5) * spread * 0.4;
      const g = 0.92 + Math.random() * 0.08;
      this.particles.emit(q, this.v, [g, g, g], 0.55, 2.2 + Math.random() * 3, 1.6 + Math.random() * 1.8, -1.2, 0.8, 1.8);
    }
  }

  sparks(p: THREE.Vector3, amount: number, color: [number, number, number] = [1, 0.85, 0.4]) {
    for (let i = 0; i < amount; i++) {
      this.v.set((Math.random() - 0.5) * 16, Math.random() * 10, (Math.random() - 0.5) * 16);
      this.particles.emit(p, this.v, color, 1, 0.22 + Math.random() * 0.2, 0.35 + Math.random() * 0.35, 22, 1.5, -0.5);
    }
  }

  gasJet(p: THREE.Vector3, backDir: THREE.Vector3) {
    this.v.copy(backDir).multiplyScalar(7 + Math.random() * 4);
    this.v.x += (Math.random() - 0.5) * 2;
    this.v.y += (Math.random() - 0.5) * 2;
    this.v.z += (Math.random() - 0.5) * 2;
    this.particles.emit(p, this.v, [0.95, 0.97, 1], 0.55, 0.55 + Math.random() * 0.4, 0.5 + Math.random() * 0.35, 0, 2.5, 1.2);
  }

  dust(p: THREE.Vector3, amount = 6) {
    for (let i = 0; i < amount; i++) {
      this.v.set((Math.random() - 0.5) * 8, Math.random() * 4, (Math.random() - 0.5) * 8);
      this.particles.emit(p, this.v, [0.66, 0.6, 0.52], 0.5, 1 + Math.random() * 1.2, 0.8 + Math.random() * 0.6, 0, 2, 1.5);
    }
  }

  update(dt: number) {
    this.particles.update(dt);
  }
}
