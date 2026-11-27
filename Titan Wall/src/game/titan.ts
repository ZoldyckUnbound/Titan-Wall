import * as THREE from "three";
import { V3, clamp, damp, rand, turnToward, angleDiff } from "./math";
import { buildTitan } from "./models";
import { KIND_HP } from "./waves";
import type { SpawnKind } from "./waves";
import type { TitanParts } from "./models";
import type { Sim } from "./types";
import type { Scout } from "./scout";
import type { Box } from "./world";

export type TitanState =
  | "wander"
  | "investigate"
  | "chase"
  | "windup"
  | "strike"
  | "recover"
  | "eating"
  | "leap"
  | "stunned"
  | "dead";

export interface HitSphere {
  c: THREE.Vector3;
  r: number;
  kind: "head" | "torso" | "pelvis" | "legs" | "nape" | "arm" | "knee";
}

// elbows and knees: [joint name in TitanParts, hit kind, radius in unit-height space]
const LIMB_JOINTS: { joint: "elbowL" | "elbowR" | "kneeL" | "kneeR"; kind: HitSphere["kind"]; r: number }[] = [
  { joint: "elbowL", kind: "arm", r: 0.06 },
  { joint: "elbowR", kind: "arm", r: 0.06 },
  { joint: "kneeL", kind: "knee", r: 0.085 },
  { joint: "kneeR", kind: "knee", r: 0.085 },
];

// forearms and thighs: a volume at the midpoint of each long limb segment, so limbs are hit between joints too
const LIMB_MIDS: { a: "shoulderL" | "shoulderR" | "hipL" | "hipR"; b: "elbowL" | "elbowR" | "kneeL" | "kneeR"; kind: HitSphere["kind"]; r: number }[] = [
  { a: "shoulderL", b: "elbowL", kind: "arm", r: 0.05 },
  { a: "shoulderR", b: "elbowR", kind: "arm", r: 0.05 },
  { a: "hipL", b: "kneeL", kind: "legs", r: 0.075 },
  { a: "hipR", b: "kneeR", kind: "legs", r: 0.075 },
];

// unit-height-space body hit volumes (nape handled separately)
/** Per-kind overrides for the specialist titans. Normals and abnormals keep the height-based formulas. */
const KIND_TUNE: Partial<Record<SpawnKind, { walk: number; run: number; turn: number; windup: number; recover: number; reach: number; hitR: number }>> = {
  // quadruped-fast: closes ground quickly, lunges often (see leapCd)
  beast: { walk: 2.6, run: 9.5, turn: 3.4, windup: 0.4, recover: 0.9, reach: 1.2, hitR: 0.5 },
  // crawling and steaming: slow to turn, a long telegraphed swipe
  reiss: { walk: 1.6, run: 5.0, turn: 1.8, windup: 0.9, recover: 1.4, reach: 2.0, hitR: 1.0 },
  // war hammer: the slowest, with a wide, late-arriving swing
  hammer: { walk: 1.5, run: 4.2, turn: 1.5, windup: 1.3, recover: 1.8, reach: 3.0, hitR: 3.0 },
  // the Founding Titan: patient, huge reach, the longest windup in the game
  founding: { walk: 1.3, run: 3.6, turn: 1.1, windup: 1.6, recover: 1.2, reach: 4.0, hitR: 4.5 },
};

const BODY_SPHERES: { kind: HitSphere["kind"]; y: number; z: number; r: number }[] = [
  { kind: "head", y: 0.9, z: 0.01, r: 0.085 },
  { kind: "torso", y: 0.69, z: 0, r: 0.16 },
  { kind: "pelvis", y: 0.49, z: 0, r: 0.13 },
  { kind: "legs", y: 0.23, z: 0, r: 0.17 },
];

const _a = new V3();
const _b = new V3();

let nextId = 1;

export class Titan {
  readonly id = nextId++;
  readonly abnormal: boolean;
  readonly kind: SpawnKind;
  readonly height: number;
  readonly napeR: number;
  readonly radius: number;
  readonly walkSpeed: number;
  readonly runSpeed: number;
  readonly reach: number;
  readonly turnRate: number;
  pos = new V3();
  vel = new V3();
  yaw = 0;
  hp = 100;
  alive = true;
  state: TitanState = "wander";
  st = 0;
  target: Scout | null = null;
  grabbed: Scout | null = null;
  heard: V3 | null = null;
  lastSeen = new V3();
  removable = false;
  parts: TitanParts;
  model: THREE.Group;
  spheres: HitSphere[] = [];
  nape = new V3();
  moveSpeed = 0;
  stepped = false;
  private lastSw = 0;

  private lostT = 0;
  private senseT = Math.random() * 0.2;
  private senseDt = 0.2;
  private path: V3[] = [];
  private pathI = 0;
  private repathT = 0;
  private waitT = rand(0.2, 2);
  private atkCd = 1;
  private leapCd = 2;
  private attackKind: "grab" | "swat" = "swat";
  private windDur = 0.6;
  private recDur = 1;
  /** Extra strike radius for hammer and Founding swings (0 for other kinds). */
  private hitR = 0;
  private windBase = 0.62;
  private recBase = 1.25;
  private eatT = 0;
  private eatDur = 6.5;
  private stunT = 0;
  private zig = 0;
  private zigT = 0;
  private vy = 0;
  private walkPhase = Math.random() * 6;
  private deadT = 0;
  private fallDir = 1;
  private steamT = 0;
  private armR = 0;
  private armL = 0;
  private elbowR = 0;
  private headYaw = 0;
  private t = Math.random() * 10;
  private lookT = 0;

  constructor(height: number, abnormal: boolean, pos: THREE.Vector3, kind: SpawnKind = abnormal ? "abnormal" : "normal") {
    this.kind = kind;
    this.height = height;
    this.abnormal = abnormal;
    this.hp = KIND_HP[kind];
    this.pos.copy(pos);
    this.napeR = clamp(0.085 * height, 0.9, 1.4);
    this.radius = Math.max(1.1, 0.11 * height);
    // speeds never go negative: the formulas were tuned for 7–15 unit titans and clamp for the giants
    this.walkSpeed = clamp(2.0 + (15 - height) * 0.08, 1.0, 3.0);
    this.runSpeed = clamp((abnormal ? 11.2 - height * 0.12 : 6.8 - height * 0.15), abnormal ? 6 : 2.8, abnormal ? 11.2 : 6.8);
    this.reach = 0.5 * height + 1.6;
    this.turnRate = abnormal ? 4.2 : 2.3;
    const tune = KIND_TUNE[kind];
    if (tune) {
      this.walkSpeed = tune.walk;
      this.runSpeed = tune.run;
      this.turnRate = tune.turn;
      this.reach = 0.5 * height + tune.reach;
      this.windBase = tune.windup;
      this.recBase = tune.recover;
      this.hitR = tune.hitR;
    }
    this.yaw = rand(0, Math.PI * 2);
    this.parts = buildTitan(height, abnormal, this.napeR, kind);
    this.model = this.parts.root;
    this.model.position.copy(pos);
    for (let i = 0; i < BODY_SPHERES.length + 1; i++)
      this.spheres.push({ c: new V3(), r: 1, kind: i === 0 ? "nape" : BODY_SPHERES[i - 1].kind });
    // limb volumes: elbows and knees follow the animated rig (see updateLimbs)
    for (let i = 0; i < LIMB_JOINTS.length; i++) this.spheres.push({ c: new V3(), r: 1, kind: LIMB_JOINTS[i].kind });
    for (let i = 0; i < LIMB_MIDS.length; i++) this.spheres.push({ c: new V3(), r: 1, kind: LIMB_MIDS[i].kind });
    this.updateSpheres();
  }

  // ------------------------------------------------------------------ frames of reference
  toLocal(p: THREE.Vector3, out: THREE.Vector3) {
    const dx = p.x - this.pos.x;
    const dz = p.z - this.pos.z;
    const c = Math.cos(this.yaw);
    const s = Math.sin(this.yaw);
    return out.set(dx * c - dz * s, p.y - this.pos.y, dx * s + dz * c);
  }
  toWorld(l: THREE.Vector3, out: THREE.Vector3) {
    const c = Math.cos(this.yaw);
    const s = Math.sin(this.yaw);
    return out.set(this.pos.x + l.x * c + l.z * s, this.pos.y + l.y, this.pos.z - l.x * s + l.z * c);
  }
  private local(x: number, y: number, z: number, out: THREE.Vector3) {
    return this.toWorld(_a.set(x * this.height, y * this.height, z * this.height), out);
  }
  napePos(out: THREE.Vector3) {
    return out.copy(this.nape);
  }
  handPoint(out: THREE.Vector3) {
    return this.local(0, 0.5, 0.42, out);
  }
  private updateSpheres() {
    this.local(0, 0.835, -0.058, this.spheres[0].c);
    this.spheres[0].r = this.napeR;
    this.nape.copy(this.spheres[0].c);
    for (let i = 0; i < BODY_SPHERES.length; i++) {
      const b = BODY_SPHERES[i];
      const s = this.spheres[i + 1];
      this.local(0, b.y, b.z, s.c);
      s.r = b.r * this.height;
    }
  }

  // ------------------------------------------------------------------ events
  hear(p: THREE.Vector3, radius: number, src: Scout | null) {
    if (!this.alive || this.state === "eating" || this.state === "windup" || this.state === "strike" || this.state === "leap") return;
    const r = this.abnormal ? radius * 1.3 : radius;
    const d = Math.hypot(p.x - this.pos.x, p.z - this.pos.z);
    if (d > r) return;
    if (this.state === "wander" || this.state === "investigate") {
      if (this.heard === null) this.heard = new V3();
      this.heard.copy(p);
      this.state = "investigate";
      this.path = [];
      this.st = 0;
      this.waitT = 0;
    } else if (this.state === "chase" && src && this.target && src !== this.target && src.alive && !src.grabbedBy) {
      const dt = Math.hypot(this.target.pos.x - this.pos.x, this.target.pos.z - this.pos.z);
      if (d < dt * 0.6) this.target = src;
    }
  }

  onVictimLost() {
    this.grabbed = null;
    if (this.alive) {
      this.state = "recover";
      this.st = 0;
      this.recDur = 1.4;
    }
  }

  /** A thunder spear pins the titan in place. It does not pin a titan that is holding someone. */
  pin(sec: number) {
    if (!this.alive || this.grabbed || this.state === "eating") return;
    this.state = "stunned";
    this.stunT = sec;
    this.st = 0;
    this.target = null;
  }

  breakFree() {
    const s = this.grabbed;
    this.grabbed = null;
    if (s) {
      s.setGrabbed(null);
      s.vel.set(0, -3, 0);
      s.stun = 0.5;
      s.invuln = 1.5;
      s.grabImmune = 4;
    }
    this.state = "stunned";
    this.stunT = 2.4;
    this.st = 0;
  }

  kill(by: Scout | null, sim: Sim) {
    if (!this.alive) return;
    const s = this.grabbed;
    if (s) {
      this.grabbed = null;
      s.setGrabbed(null);
      s.vel.set(0, -2, 0);
      s.stun = 0.8;
      s.invuln = 1.5;
      s.grabImmune = 4;
    }
    this.alive = false;
    this.state = "dead";
    this.hp = 0;
    this.deadT = 0;
    this.vel.set(0, 0, 0);
    this.fallDir = Math.random() < 0.5 ? 1 : -1;
    this.target = null;
    sim.fx.steam(this.nape, 40, 6, 7);
    sim.onTitanKilled(this, by);
  }

  // ------------------------------------------------------------------ AI
  private sense(sim: Sim) {
    this.senseDt = 0.15 + Math.random() * 0.1;
    this.senseT = this.senseDt;
    const eyeY = this.pos.y + this.height * 0.88;
    const senseR = 8 + this.height * 0.6;
    const cosCone = this.abnormal ? 0.09 : 0.42;
    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    let best: Scout | null = null;
    let bestScore = Infinity;
    for (const s of sim.scouts) {
      if (!s.alive || s.grabbedBy) continue;
      const dx = s.pos.x - this.pos.x;
      const dz = s.pos.z - this.pos.z;
      const dH = Math.hypot(dx, dz);
      let sees = dH < senseR;
      if (!sees && dH < 80) {
        const cosA = (dx * fx + dz * fz) / Math.max(0.01, dH);
        if (cosA > cosCone) {
          _a.set(this.pos.x, eyeY, this.pos.z);
          sees = !sim.world.segmentBlocked(_a, s.pos);
        }
      }
      if (!sees) continue;
      const score = dH + Math.max(0, s.pos.y - this.height) * 0.8;
      if (score < bestScore) {
        bestScore = score;
        best = s;
      }
    }
    if (best) {
      this.target = best;
      this.lastSeen.copy(best.pos);
      this.lostT = 0;
      if (this.state === "wander" || this.state === "investigate") {
        this.state = "chase";
        this.path = [];
        this.repathT = 0;
        this.st = 0;
      }
    } else if (this.target) {
      this.lostT += this.senseDt;
      if (this.lostT > 5) {
        this.target = null;
        if (this.state === "chase") {
          this.heard = (this.heard ?? new V3()).copy(this.lastSeen);
          this.state = "investigate";
          this.path = [];
          this.waitT = 0;
        }
      }
    }
  }

  private followPath(dt: number, speed: number, turnRate: number): boolean {
    const wp = this.path[this.pathI];
    if (!wp) return true;
    const dx = wp.x - this.pos.x;
    const dz = wp.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 2.6) {
      this.pathI++;
      return this.pathI >= this.path.length;
    }
    this.steer(dt, Math.atan2(dx, dz), speed, turnRate);
    return false;
  }

  private steer(dt: number, want: number, speed: number, turnRate: number) {
    this.yaw = turnToward(this.yaw, want, turnRate * dt);
    const align = Math.max(0.08, Math.cos(Math.min(1.5, Math.abs(angleDiff(this.yaw, want)))));
    this.vel.set(Math.sin(this.yaw) * speed * align, 0, Math.cos(this.yaw) * speed * align);
  }

  private stop() {
    this.vel.set(0, 0, 0);
  }

  /** Scripted walk (wave-10 colossal): walks straight at `to` and holds once within `arriveR`. */
  scripted: { to: V3; arriveR: number; arrived: boolean } | null = null;

  update(dt: number, sim: Sim) {
    this.t += dt;
    if (this.state === "dead") {
      this.updateDead(dt, sim);
      return;
    }
    if (this.scripted) {
      this.updateScripted(dt, sim);
      return;
    }
    this.st += dt;
    this.atkCd = Math.max(0, this.atkCd - dt);
    if (this.kind === "reiss") {
      // Reiss vents heat: a steady plume from the shoulders, thicker when it runs
      this.steamT -= dt;
      if (this.steamT <= 0) {
        this.steamT = this.moveSpeed > 2 ? 0.14 : 0.35;
        _a.set(this.pos.x, this.pos.y + this.height * 0.82, this.pos.z);
        sim.fx.steam(_a, 2, this.height * 0.35, 4);
      }
    }
    this.leapCd = Math.max(0, this.leapCd - dt);
    this.senseT -= dt;
    if (this.senseT <= 0 && this.state !== "eating") this.sense(sim);

    switch (this.state) {
      case "wander":
        this.doWander(dt, sim);
        break;
      case "investigate":
        this.doInvestigate(dt, sim);
        break;
      case "chase":
        this.doChase(dt, sim);
        break;
      case "windup": {
        this.stop();
        const t = this.target;
        if (t && t.alive) this.yaw = turnToward(this.yaw, Math.atan2(t.pos.x - this.pos.x, t.pos.z - this.pos.z), this.turnRate * 0.7 * dt);
        if (this.st >= this.windDur) {
          this.state = "strike";
          this.st = 0;
          this.strike(sim);
        }
        break;
      }
      case "strike":
        this.stop();
        if (this.st > 0.25 && this.state === "strike") {
          this.state = "recover";
          this.st = 0;
        }
        break;
      case "recover":
        this.stop();
        if (this.st >= this.recDur) {
          this.state = this.target ? "chase" : "wander";
          this.st = 0;
        }
        break;
      case "stunned":
        this.stop();
        if (this.st >= this.stunT) {
          this.state = "recover";
          this.recDur = 0.4;
          this.st = 0;
        }
        break;
      case "eating":
        this.doEating(dt, sim);
        break;
      case "leap":
        this.doLeap(dt, sim);
        break;
    }

    this.integrate(dt, sim);
    this.updateSpheres();
    this.animate(dt, sim);
    this.updateLimbs();
  }

  /** Limb hit volumes sit on the animated elbows and knees, so swats and slashes land where the limb is. */
  private updateLimbs() {
    this.model.updateMatrixWorld(true);
    const P = this.parts;
    const base = BODY_SPHERES.length + 1;
    LIMB_JOINTS.forEach((L, i) => {
      const s = this.spheres[base + i];
      const j = P[L.joint];
      if (j) j.getWorldPosition(s.c);
      s.r = L.r * this.height;
    });
    const mid = base + LIMB_JOINTS.length;
    LIMB_MIDS.forEach((M, i) => {
      const s = this.spheres[mid + i];
      const a = P[M.a], b = P[M.b];
      if (a && b) {
        a.getWorldPosition(_a);
        b.getWorldPosition(_b);
        s.c.set((_a.x + _b.x) / 2, (_a.y + _b.y) / 2, (_a.z + _b.z) / 2);
      }
      s.r = M.r * this.height;
    });
  }

  private doWander(dt: number, sim: Sim) {
    if (this.waitT > 0) {
      this.waitT -= dt;
      this.stop();
      this.headYaw = damp(this.headYaw, Math.sin(this.t * 0.7) * 0.6, 2, dt);
      return;
    }
    if (this.pathI >= this.path.length) {
      const nav = sim.world.nav;
      const goal = nav.freeInRing(this.pos.x, this.pos.z, 30, 900);
      const p = goal ? nav.findPath(this.pos, goal, 0.5, 1) : null;
      if (!p || !p.length) {
        this.waitT = 1;
        return;
      }
      this.path = p;
      this.pathI = 0;
      return;
    }
    if (this.followPath(dt, this.walkSpeed, 1.6)) this.waitT = rand(1, 3.5);
  }

  private doInvestigate(dt: number, sim: Sim) {
    if (!this.heard) {
      this.state = "wander";
      return;
    }
    if (this.waitT > 0) {
      this.waitT -= dt;
      this.stop();
      this.yaw += Math.sin(this.t * 1.3) * dt * 0.8;
      if (this.waitT <= 0) {
        this.heard = null;
        this.state = "wander";
        this.path = [];
      }
      return;
    }
    if (this.path.length === 0 || this.pathI >= this.path.length) {
      if (Math.hypot(this.heard.x - this.pos.x, this.heard.z - this.pos.z) < 6) {
        this.waitT = rand(1.5, 3);
        return;
      }
      const p = sim.world.nav.findPath(this.pos, this.heard, 0.5, 1);
      if (!p || !p.length) {
        this.waitT = 1.5;
        return;
      }
      this.path = p;
      this.pathI = 0;
      return;
    }
    if (this.followPath(dt, this.walkSpeed * 1.6, 2.2)) {
      this.path = [];
      this.waitT = rand(1.5, 3);
    }
  }

  private doChase(dt: number, sim: Sim) {
    const t = this.target;
    if (!t || !t.alive || t.grabbedBy) {
      this.target = null;
      this.state = "wander";
      this.path = [];
      this.pathI = 0;
      return;
    }
    const dx = t.pos.x - this.pos.x;
    const dz = t.pos.z - this.pos.z;
    const dH = Math.hypot(dx, dz);
    let want = Math.atan2(dx, dz);
    const err = Math.abs(angleDiff(this.yaw, want));
    const lowEnough = t.pos.y < 1.1 * this.height + 1;

    // melee
    if (this.atkCd <= 0 && dH < this.reach && lowEnough) {
      this.stop();
      this.yaw = turnToward(this.yaw, want, this.turnRate * dt);
      if (err < 0.6) this.startWindup(t);
      return;
    }
    // abnormal leap at low-flying scouts
    if (
      this.abnormal &&
      this.leapCd <= 0 &&
      dH > 5 &&
      dH < 26 &&
      !t.grounded &&
      t.pos.y > 2 &&
      t.pos.y < this.height * 1.2 + 5 &&
      err < 0.8
    ) {
      this.startLeap(t, dH);
      return;
    }

    let speed = this.runSpeed;
    if (dH < 14) {
      // direct approach in the open
      if (this.abnormal) {
        this.zigT -= dt;
        if (this.zigT <= 0) {
          this.zigT = rand(0.45, 1.2);
          this.zig = Math.random() < 0.3 ? 0 : rand(-1, 1) * 0.95;
        }
        want += this.zig * clamp(dH / 14, 0.2, 1);
      }
      this.steer(dt, want, speed, this.turnRate);
    } else {
      this.repathT -= dt;
      if (this.repathT <= 0 || this.pathI >= this.path.length) {
        this.repathT = 0.9;
        const p = sim.world.nav.findPath(this.pos, t.pos, 0.5, 1);
        this.path = p ?? [];
        this.pathI = 0;
      }
      if (this.path.length && this.pathI < this.path.length) {
        if (this.abnormal) {
          this.zigT -= dt;
          if (this.zigT <= 0) {
            this.zigT = rand(0.5, 1.3);
            speed *= Math.random() < 0.25 ? 0.4 : 1;
          }
        }
        this.followPath(dt, speed, this.turnRate);
      } else this.steer(dt, want, speed, this.turnRate);
    }
  }

  private startWindup(t: Scout) {
    this.attackKind = t.pos.y < this.height * 0.7 ? (Math.random() < 0.62 ? "grab" : "swat") : Math.random() < 0.25 ? "grab" : "swat";
    this.state = "windup";
    this.st = 0;
    this.windDur = this.abnormal ? 0.36 : this.windBase;
    this.recDur = this.abnormal ? 0.8 : this.recBase;
    this.atkCd = this.windDur + this.recDur + 0.3;
  }

  private startLeap(t: Scout, dH: number) {
    this.state = "leap";
    this.st = 0;
    this.leapCd = 5 + Math.random() * 2;
    const want = Math.atan2(t.pos.x - this.pos.x, t.pos.z - this.pos.z);
    this.yaw = want;
    const sp = clamp(dH * 1.35, 9, 22);
    this.vel.set(Math.sin(want) * sp, 0, Math.cos(want) * sp);
    this.vy = 15 + t.pos.y * 0.35;
  }

  private doLeap(dt: number, sim: Sim) {
    this.pos.y += this.vy * dt;
    this.vy -= 32 * dt;
    // grab/swat check in flight
    const hp = this.handPoint(_b);
    const R = 0.32 * this.height + 2.2 + this.hitR;
    for (const s of sim.scouts) {
      if (!s.alive || s.grabbedBy || s.invuln > 0) continue;
      if (s.pos.distanceTo(hp) < R) {
        if (!this.grabbed && Math.random() < 0.55 && this.canGrab(s, sim)) this.grab(s, sim);
        else this.swat(s, sim);
        if (this.grabbed) {
          this.pos.y = 0;
          this.vy = 0;
          return;
        }
      }
    }
    if (this.pos.y <= 0 && this.vy < 0) {
      this.pos.y = 0;
      this.vy = 0;
      this.vel.set(0, 0, 0);
      this.state = "recover";
      this.recDur = 0.9;
      this.st = 0;
      this.atkCd = 1;
      sim.fx.dust(this.pos, 14);
    }
  }

  private strike(sim: Sim) {
    const hp = this.handPoint(_b);
    const R = 0.3 * this.height + 2.0 + this.hitR;
    let grabbedOne = false;
    for (const s of sim.scouts) {
      if (!s.alive || s.grabbedBy) continue;
      if (s.pos.distanceTo(hp) > R) continue;
      if (this.attackKind === "grab" && !this.grabbed && !grabbedOne && this.canGrab(s, sim)) {
        this.grab(s, sim);
        grabbedOne = true;
      } else this.swat(s, sim);
    }
    sim.fx.dust(hp, 8);
  }

  /**
   * Whether this titan may take hold of `s`. Titans never chain-grab: a scout who just slipped out of
   * another titan's hand is immune for a few seconds, and nobody grabs while a second titan is within
   * arm's reach of the scout (adjacent titans would otherwise pass the player between them).
   */
  canGrab(s: Scout, sim: Sim) {
    if (s.grabImmune > 0 || s.grabbedBy || this.kind === "colossal" || this.kind === "founding") return false;
    for (const o of sim.titans) {
      if (o === this || !o.alive) continue;
      if (Math.hypot(o.pos.x - s.pos.x, o.pos.z - s.pos.z) < 9) return false;
    }
    return true;
  }

  private grab(s: Scout, sim: Sim) {
    this.grabbed = s;
    s.setGrabbed(this);
    this.state = "eating";
    this.eatT = 0;
    this.eatDur = s.isPlayer ? 6.5 : 8.5;
    this.st = 0;
    sim.onGrab(s, this);
  }

  private swat(s: Scout, sim: Sim) {
    _a.subVectors(s.pos, this.pos);
    s.knock(_a, 24 + Math.random() * 6, 11 + Math.random() * 6);
    s.damage(26, "swat", sim);
    s.invuln = Math.max(s.invuln, 0.7);
    sim.onSwat(s, this);
  }

  private doEating(dt: number, sim: Sim) {
    const s = this.grabbed;
    if (!s || !s.alive) {
      this.grabbed = null;
      this.state = "recover";
      this.recDur = 1;
      this.st = 0;
      return;
    }
    this.stop();
    this.eatT += dt;
    this.local(0, 0.8, 0.2, s.pos);
    s.vel.set(0, 0, 0);
    if (this.eatT >= this.eatDur) {
      sim.onEaten(s, this);
      s.die("eaten", sim);
    }
  }

  private integrate(dt: number, sim: Sim) {
    this.moveSpeed = Math.hypot(this.vel.x, this.vel.z);
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    const r = this.radius;
    const smash: Box[] = [];
    for (const b of sim.world.boxes) {
      if (this.pos.x < b.minX - r || this.pos.x > b.maxX + r || this.pos.z < b.minZ - r || this.pos.z > b.maxZ + r) continue;
      if (b.kind === "building" && this.height >= 9 && this.moveSpeed > 2.5 && b.spec?.destructible) smash.push(b);
      const qx = clamp(this.pos.x, b.minX, b.maxX);
      const qz = clamp(this.pos.z, b.minZ, b.maxZ);
      const dx = this.pos.x - qx;
      const dz = this.pos.z - qz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-6) {
        const d = Math.sqrt(d2);
        this.pos.x += (dx / d) * (r - d);
        this.pos.z += (dz / d) * (r - d);
      } else {
        const l = this.pos.x - b.minX;
        const rr = b.maxX - this.pos.x;
        const u = this.pos.z - b.minZ;
        const dd = b.maxZ - this.pos.z;
        const m = Math.min(l, rr, u, dd);
        if (m === l) this.pos.x = b.minX - r;
        else if (m === rr) this.pos.x = b.maxX + r;
        else if (m === u) this.pos.z = b.minZ - r;
        else this.pos.z = b.maxZ + r;
      }
    }
    for (const b of smash) {
      if (sim.world.destroyBuilding(b)) sim.fx.dust(this.pos, 10);
    }
    for (const o of sim.titans) {
      if (o === this || !o.alive) continue;
      const dx = this.pos.x - o.pos.x;
      const dz = this.pos.z - o.pos.z;
      const d = Math.hypot(dx, dz);
      const min = (r + o.radius) * 0.8;
      if (d < min && d > 0.01) {
        this.pos.x += (dx / d) * (min - d) * 0.5;
        this.pos.z += (dz / d) * (min - d) * 0.5;
      }
    }
    const lim = sim.world.half - r;
    this.pos.x = clamp(this.pos.x, -lim, lim);
    this.pos.z = clamp(this.pos.z, -lim, lim);
  }

  private updateScripted(dt: number, sim: Sim) {
    const s = this.scripted!;
    const dx = s.to.x - this.pos.x;
    const dz = s.to.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (!s.arrived && d < s.arriveR) s.arrived = true;
    if (s.arrived) {
      this.stop();
      this.moveSpeed = 0;
      return;
    }
    const sp = Math.max(5, this.walkSpeed * 2);
    this.vel.set((dx / d) * sp, 0, (dz / d) * sp);
    this.yaw = turnToward(this.yaw, Math.atan2(dx, dz), this.turnRate * dt);
    this.integrate(dt, sim);
    this.updateSpheres();
    this.updateLimbs();
    this.parts.root.position.copy(this.pos);
    this.parts.root.rotation.y = this.yaw;
  }

  private updateDead(dt: number, sim: Sim) {
    this.deadT += dt;
    const f = clamp(this.deadT / 1.1, 0, 1);
    const p = this.parts;
    p.body.rotation.x = this.fallDir * f * f * Math.PI * 0.49;
    p.halo.visible = false;
    p.marker.visible = false;
    if (this.deadT < 7) {
      this.steamT -= dt;
      if (this.steamT <= 0) {
        this.steamT = 0.12;
        const k = Math.min(1, this.deadT / 1.1);
        _a.set(
          this.pos.x + Math.sin(this.yaw) * this.fallDir * this.height * 0.45 * k,
          this.pos.y + this.height * (0.5 - 0.35 * k),
          this.pos.z + Math.cos(this.yaw) * this.fallDir * this.height * 0.45 * k
        );
        sim.fx.steam(_a, 3, this.height * 0.5, 5);
      }
    }
    if (this.deadT > 6) this.model.position.y = this.pos.y - (this.deadT - 6) * this.height * 0.06;
    if (this.deadT > 10) this.removable = true;
    this.model.position.x = this.pos.x;
    this.model.position.z = this.pos.z;
  }

  // ------------------------------------------------------------------ animation
  private animate(dt: number, sim: Sim) {
    void sim;
    this.model.position.copy(this.pos);
    this.model.rotation.y = this.yaw;
    const P = this.parts;
    P.halo.scale.setScalar(1 + Math.sin(this.t * 6) * 0.12);
    (P.halo.material as THREE.MeshBasicMaterial).opacity = 0.16 + Math.sin(this.t * 6) * 0.06;
    if (!P.hipL || !P.hipR || !P.kneeL || !P.kneeR || !P.shoulderL || !P.shoulderR || !P.elbowR || !P.head || !P.mouth) return;

    const hs = this.moveSpeed;
    const stride = (this.abnormal ? 0.07 : 0.09) * this.height;
    if (hs > 0.2) this.walkPhase += (dt * hs) / stride;
    const amp = clamp(hs / 6, 0, 1) * (this.abnormal ? 1.0 : 0.65);
    const sw = Math.sin(this.walkPhase);
    if (hs > 1 && Math.sign(sw) !== Math.sign(this.lastSw) && Math.abs(sw) < 0.4) this.stepped = true;
    this.lastSw = sw;
    P.hipL.rotation.x = sw * amp;
    P.hipR.rotation.x = -sw * amp;
    P.kneeL.rotation.x = Math.max(0, -Math.sin(this.walkPhase + 0.6)) * amp * 1.1;
    P.kneeR.rotation.x = Math.max(0, Math.sin(this.walkPhase + 0.6)) * amp * 1.1;
    P.body.position.y = Math.abs(sw) * 0.01 * amp;

    // arms
    let tR = -sw * amp * 0.7;
    let tL = sw * amp * 0.7;
    let tE = 0.15 + amp * 0.3;
    if (this.abnormal && hs > 2) {
      tR = -2.6 + Math.sin(this.walkPhase * 1.2) * 0.4;
      tL = -2.6 - Math.sin(this.walkPhase * 1.2) * 0.4;
      tE = 0.3;
    }
    if (this.state === "windup") {
      const k = clamp(this.st / this.windDur, 0, 1);
      if (this.attackKind === "swat") {
        tR = -2.9 * k;
        tL = -0.3;
      } else {
        tR = -1.45 * k;
        tL = -1.45 * k;
      }
      tE = 0.2;
    } else if (this.state === "strike" || (this.state === "recover" && this.st < 0.5)) {
      tR = this.attackKind === "swat" ? -0.2 : -1.2;
      tL = this.attackKind === "swat" ? 0 : -1.2;
    } else if (this.state === "eating") {
      tR = -2.1;
      tE = -1.5;
      tL = -0.4;
    } else if (this.state === "leap") {
      tR = tL = -2.7;
    }
    const lam = this.state === "windup" ? 8 : 16;
    this.armR = damp(this.armR, tR, lam, dt);
    this.armL = damp(this.armL, tL, lam, dt);
    this.elbowR = damp(this.elbowR, tE, 12, dt);
    P.shoulderR.rotation.x = this.armR;
    P.shoulderL.rotation.x = this.armL;
    P.elbowR.rotation.x = this.elbowR;
    P.elbowL!.rotation.x = 0.15 + amp * 0.3;
    if (this.abnormal) {
      P.shoulderL.rotation.z = -0.35;
      P.shoulderR.rotation.z = 0.35;
    }

    // lean
    const lean = this.abnormal && hs > 2 ? 0.4 : this.state === "leap" ? 0.6 : hs > 3 ? 0.1 : 0;
    P.body.rotation.x = damp(P.body.rotation.x, lean, 6, dt);

    // head tracks target
    let ty = 0;
    if (this.target && this.target.alive && this.state !== "wander") {
      ty = clamp(angleDiff(this.yaw, Math.atan2(this.target.pos.x - this.pos.x, this.target.pos.z - this.pos.z)), -0.9, 0.9);
    } else if (this.state === "wander" || this.state === "investigate") ty = this.headYaw * 0.5;
    this.headYaw = damp(this.headYaw, ty, 5, dt);
    P.head.rotation.y = this.headYaw;
    const open = this.state === "eating" && this.eatT > this.eatDur - 1.6 ? 3 : this.state === "windup" ? 2.2 : 1;
    P.mouth.scale.y = damp(P.mouth.scale.y, (this.abnormal ? 2.2 : 1.3) * open, 10, dt);
    this.lookT += dt;
  }
}
