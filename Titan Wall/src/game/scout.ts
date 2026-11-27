import * as THREE from "three";
import { V3, clamp, damp, fwdOf, rightOf, turnToward } from "./math";
import { buildScout } from "./models";
import type { ScoutParts, ScoutPalette } from "./models";
import { newContact } from "./world";
import type { Sim } from "./types";
import type { Titan } from "./titan";

export const GRAVITY = 24;
export const SCOUT_R = 0.85;
export const HOOK_RANGE = 75;
const BOOST_ACC = 40;
const REEL_ACC = 28;
const RUN_SPEED = 9;
const CRASH_V = 17;
const MAX_SPEED = 64;

export class Hook {
  state: "idle" | "flying" | "attached" = "idle";
  tip = new V3();
  anchor = new V3();
  titan: Titan | null = null;
  local = new V3();
  ropeLen = 0;
  age = 0;
  cooldown = 0;
  missed = false;
}

/** The only interface between a "driver" (player input or bot AI) and the ODM physics. */
export interface ScoutControl {
  move: THREE.Vector3; // desired horizontal move (world space, |v| <= 1)
  boost: boolean; // gas boost (Space)
  boostDir: THREE.Vector3; // boost direction when no hook is attached
  reel: boolean; // rope reel-in
  fire: [THREE.Vector3 | null, THREE.Vector3 | null]; // one-shot hook launch directions
  hold: [boolean, boolean]; // keep hook attached while true
  slash: boolean; // one-shot
  swap: boolean; // one-shot blade swap
  struggle: boolean; // one-shot struggle while grabbed
}
export const newControl = (): ScoutControl => ({
  move: new V3(),
  boost: false,
  boostDir: new V3(0, 0, 1),
  reel: false,
  fire: [null, null],
  hold: [false, false],
  slash: false,
  swap: false,
  struggle: false,
});
export function clearControl(c: ScoutControl) {
  c.move.set(0, 0, 0);
  c.boost = false;
  c.reel = false;
  c.fire[0] = c.fire[1] = null;
  c.hold[0] = c.hold[1] = false;
  c.slash = false;
  c.swap = false;
  c.struggle = false;
}

export interface ScoutConfig {
  id: string;
  name: string;
  isPlayer: boolean;
  palette: ScoutPalette;
  maxHp: number;
  killSpeed: number;
  dmgMult: number;
  crashResist?: number; // 1 = full damage from collisions
}

const _t = new V3();
const _u = new V3();
const _acc = new V3();
const _sum = new V3();
const _n = new V3();
const _f = new V3();
const _r = new V3();

export class Scout {
  readonly id: string;
  readonly name: string;
  readonly isPlayer: boolean;
  pos = new V3();
  vel = new V3();
  yaw = 0;
  hp: number;
  maxHp: number;
  gas = 100;
  maxGas = 100;
  bladeDur = 100;
  spare = 3;
  maxSpare = 4;
  swapT = 0;
  slashT = 0;
  slashDur = 0.38;
  slashHit = false;
  stun = 0;
  invuln = 0;
  hurtFlash = 0;
  grounded = false;
  alive = true;
  grabbedBy: Titan | null = null;
  struggle = 0;
  killSpeed: number;
  dmgMult: number;
  kills = 0;
  crashScale = 1;
  hooks: [Hook, Hook] = [new Hook(), new Hook()];
  parts: ScoutParts;
  model: THREE.Group;
  boosting = false;
  lastBoostDir = new V3(0, 1, 0);
  speed = 0;
  maxImpactSeen = 0;
  msgCd = 0;
  readonly contact = newContact();
  private noiseT = 0;
  private stepT = 0;
  private walkPhase = 0;
  private animT = Math.random() * 10;
  private jetT = 0;

  constructor(cfg: ScoutConfig) {
    this.id = cfg.id;
    this.name = cfg.name;
    this.isPlayer = cfg.isPlayer;
    this.maxHp = cfg.maxHp;
    this.hp = cfg.maxHp;
    this.killSpeed = cfg.killSpeed;
    this.dmgMult = cfg.dmgMult;
    this.crashScale = cfg.crashResist ?? 1;
    this.parts = buildScout(cfg.palette);
    this.model = this.parts.root;
  }

  get hasBlades() {
    return this.bladeDur > 0 && this.swapT <= 0;
  }
  get slashing() {
    return this.slashT > 0 && !this.slashHit;
  }

  reset(p: THREE.Vector3) {
    this.pos.copy(p);
    this.pos.y = Math.max(this.pos.y, SCOUT_R);
    this.vel.set(0, 0, 0);
    this.hp = this.maxHp;
    this.gas = this.maxGas;
    this.bladeDur = 100;
    this.spare = 3;
    this.swapT = this.slashT = this.stun = 0;
    this.invuln = 2;
    this.alive = true;
    this.grabbedBy = null;
    this.struggle = 0;
    this.model.visible = true;
    this.hooks.forEach((_, i) => this.releaseHook(i));
  }

  handPos(side: number, out: THREE.Vector3) {
    rightOf(this.yaw, _r);
    const s = side === 0 ? -0.4 : 0.4;
    return out.set(this.pos.x + _r.x * s, this.pos.y + 0.15, this.pos.z + _r.z * s);
  }

  releaseHook(side: number) {
    const h = this.hooks[side];
    h.state = "idle";
    h.titan = null;
    h.cooldown = 0.18;
  }

  private fireHook(side: number, dir: THREE.Vector3, sim: Sim) {
    const h = this.hooks[side];
    const o = this.handPos(side, _t);
    const d = _u.copy(dir).normalize();
    const hit = sim.rayWorld(o, d, HOOK_RANGE, true);
    h.state = "flying";
    h.tip.copy(o);
    h.age = 0;
    if (hit) {
      h.anchor.copy(hit.point);
      h.missed = false;
      h.titan = hit.titan ?? null;
      if (h.titan) h.titan.toLocal(hit.point, h.local);
    } else {
      h.anchor.copy(o).addScaledVector(d, HOOK_RANGE);
      h.missed = true;
      h.titan = null;
    }
    sim.noise(this.pos, 22, this);
  }

  knock(dir: THREE.Vector3, speed: number, up: number) {
    this.vel.copy(dir).setY(0).normalize().multiplyScalar(speed);
    this.vel.y = up;
    this.stun = 0.7;
    this.hooks.forEach((_, i) => this.releaseHook(i));
  }

  damage(amount: number, cause: string, sim: Sim) {
    if (!this.alive) return;
    if (this.invuln > 0 && cause !== "squeeze") return;
    this.hp -= amount;
    this.hurtFlash = 0.35;
    if (this.hp <= 0) this.die(cause, sim);
  }

  die(cause: string, sim: Sim) {
    if (!this.alive) return;
    this.alive = false;
    this.hp = 0;
    this.hooks.forEach((_, i) => this.releaseHook(i));
    if (this.grabbedBy) {
      this.grabbedBy.onVictimLost();
      this.grabbedBy = null;
    }
    this.model.visible = false;
    sim.fx.sparks(this.pos, 18, [0.9, 0.2, 0.15]);
    sim.onScoutDied(this, cause);
  }

  update(dt: number, ctrl: ScoutControl, sim: Sim) {
    if (!this.alive) return;
    this.animT += dt;
    this.invuln = Math.max(0, this.invuln - dt);
    this.stun = Math.max(0, this.stun - dt);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt);
    this.slashT = Math.max(0, this.slashT - dt);
    this.msgCd = Math.max(0, this.msgCd - dt);
    if (this.swapT > 0) {
      this.swapT -= dt;
      if (this.swapT <= 0) {
        this.swapT = 0;
        this.bladeDur = 100;
        this.spare = Math.max(0, this.spare - 1);
      }
    }
    for (const h of this.hooks) h.cooldown = Math.max(0, h.cooldown - dt);

    if (this.grabbedBy) {
      this.updateGrabbed(dt, ctrl, sim);
      return;
    }

    // ---- blades
    if (ctrl.swap && this.swapT <= 0 && this.spare > 0 && this.bladeDur < 100) this.swapT = 1.1;
    if (ctrl.slash && this.slashT <= 0 && this.swapT <= 0 && this.stun <= 0) {
      if (this.bladeDur > 0) {
        this.slashT = this.slashDur;
        this.slashHit = false;
      } else if (this.msgCd <= 0) {
        this.msgCd = 2;
        if (this.isPlayer) sim.toast(this.spare > 0 ? "Blades broken — press R to swap!" : "No blades left — find a supply depot!", "bad");
        else sim.bark(this, "blades_broken");
      }
    }

    // ---- hooks
    for (let s = 0; s < 2; s++) {
      const h = this.hooks[s];
      const f = ctrl.fire[s];
      if (f && h.state === "idle" && h.cooldown <= 0 && this.stun <= 0) this.fireHook(s, f, sim);
      if (!ctrl.hold[s] && h.state !== "idle") this.releaseHook(s);
      if (h.state === "idle") continue;
      if (h.titan) {
        if (!h.titan.alive) {
          this.releaseHook(s);
          continue;
        }
        h.titan.toWorld(h.local, h.anchor);
      }
      if (h.state === "flying") {
        const step = 175 * dt;
        const to = _t.subVectors(h.anchor, h.tip);
        const d = to.length();
        if (d <= step) {
          h.tip.copy(h.anchor);
          if (h.missed) {
            h.state = "idle";
            h.cooldown = 0.3;
          } else {
            h.state = "attached";
            h.age = 0;
            h.ropeLen = this.pos.distanceTo(h.anchor);
            sim.noise(h.anchor, 18, this);
            if (!h.titan) sim.fx.sparks(h.anchor, 4, [0.9, 0.9, 0.85]);
          }
        } else h.tip.addScaledVector(to, step / d);
      } else {
        h.tip.copy(h.anchor);
        h.age += dt;
      }
    }

    // ---- forces
    const stunned = this.stun > 0;
    _acc.set(0, -GRAVITY, 0);
    _sum.set(0, 0, 0);
    let nAtt = 0;
    for (const h of this.hooks) {
      if (h.state !== "attached") continue;
      const d = _n.subVectors(h.anchor, this.pos).length();
      if (d > 0.01) {
        _sum.addScaledVector(_n, 1 / d);
        nAtt++;
      }
    }
    const mv = ctrl.move;
    const hasMove = !stunned && mv.lengthSq() > 0.01;
    this.boosting = false;

    // boost
    if (ctrl.boost && this.gas > 0 && !stunned) {
      const dir = this.lastBoostDir;
      if (nAtt > 0) {
        dir.copy(_sum).normalize().multiplyScalar(0.85);
        if (hasMove) dir.addScaledVector(_t.copy(mv).normalize(), 0.3);
        dir.normalize();
      } else {
        dir.copy(ctrl.boostDir);
        if (dir.lengthSq() < 0.01) dir.set(0, 1, 0);
        dir.normalize();
        if (this.grounded) {
          // launch off the ground with a hop so the thrusters can carry us up
          dir.y = Math.max(dir.y, 0.7);
          dir.normalize();
          this.vel.y = Math.max(this.vel.y, 8);
          this.grounded = false;
        }
      }
      _acc.addScaledVector(dir, BOOST_ACC);
      this.gas = Math.max(0, this.gas - 11 * dt);
      this.boosting = true;
      this.noiseT -= dt;
      if (this.noiseT <= 0) {
        this.noiseT = 0.45;
        sim.noise(this.pos, 42, this);
      }
    }
    // reel
    if (ctrl.reel && !stunned) {
      for (const h of this.hooks) {
        if (h.state !== "attached") continue;
        const dist = _n.subVectors(h.anchor, this.pos).length();
        if (dist < 0.5) continue;
        _n.divideScalar(dist);
        if (_u.copy(this.vel).dot(_n) < 24) _acc.addScaledVector(_n, REEL_ACC);
        h.ropeLen = Math.max(2.5, Math.min(h.ropeLen, dist) - 13 * dt);
      }
    }
    // air control
    if (!this.grounded && hasMove) _acc.addScaledVector(mv, 8);

    // ground run
    if (this.grounded && !stunned && !this.boosting) {
      const tx = hasMove ? mv.x * RUN_SPEED : 0;
      const tz = hasMove ? mv.z * RUN_SPEED : 0;
      const dx = tx - this.vel.x;
      const dz = tz - this.vel.z;
      const len = Math.hypot(dx, dz);
      const maxD = (hasMove ? 48 : 26) * dt;
      if (len <= maxD) {
        this.vel.x = tx;
        this.vel.z = tz;
      } else {
        this.vel.x += (dx / len) * maxD;
        this.vel.z += (dz / len) * maxD;
      }
    }

    // ---- integrate in sub-steps
    const steps = Math.min(4, Math.max(1, Math.ceil(dt / 0.0111)));
    const h = dt / steps;
    let maxImpact = 0;
    let impactN = 0;
    for (let i = 0; i < steps; i++) {
      this.vel.addScaledVector(_acc, h);
      this.pos.addScaledVector(this.vel, h);
      for (const hk of this.hooks) {
        if (hk.state !== "attached") continue;
        const ta = _n.subVectors(hk.anchor, this.pos);
        const d = ta.length();
        if (d > hk.ropeLen && d > 0.001) {
          ta.divideScalar(d);
          this.pos.addScaledVector(ta, d - hk.ropeLen);
          const vr = this.vel.dot(ta);
          if (vr < 0) this.vel.addScaledVector(ta, -vr);
        } else if (d < hk.ropeLen) hk.ropeLen = Math.max(2.5, d);
      }
      sim.world.resolveSphere(this.pos, this.vel, SCOUT_R, this.contact);
      if (this.contact.impact > maxImpact) {
        maxImpact = this.contact.impact;
        impactN = this.contact.normal.y;
      }
    }
    this.grounded = this.contact.grounded;

    // drag / speed cap
    const sp = this.vel.length();
    if (sp > 0.01) {
      const drag = 0.04 + (sp > 40 ? 0.35 : 0);
      this.vel.multiplyScalar(Math.max(0, 1 - drag * dt));
      if (sp > MAX_SPEED) this.vel.multiplyScalar(MAX_SPEED / sp);
    }
    this.speed = this.vel.length();

    // world bounds
    const B = 150;
    if (Math.abs(this.pos.x) > B) {
      this.pos.x = Math.sign(this.pos.x) * B;
      this.vel.x = 0;
    }
    if (Math.abs(this.pos.z) > B) {
      this.pos.z = Math.sign(this.pos.z) * B;
      this.vel.z = 0;
    }
    if (this.pos.y > 120) {
      this.pos.y = 120;
      this.vel.y = Math.min(0, this.vel.y);
    }

    // impacts
    if (maxImpact > 7) sim.fx.dust(this.pos, maxImpact > CRASH_V ? 10 : 3);
    if (maxImpact > CRASH_V && this.invuln <= 0) {
      const dmg = Math.min(this.isPlayer ? 60 : 8, (maxImpact - CRASH_V) * (impactN > 0.6 ? 1.6 : 2.6) * this.crashScale);
      this.maxImpactSeen = maxImpact;
      sim.noise(this.pos, 34, this);
      this.damage(dmg, "crash", sim);
      this.invuln = Math.max(this.invuln, 0.6);
      sim.onCrash(this, maxImpact, dmg);
      this.stun = Math.max(this.stun, maxImpact > 26 ? 0.6 : 0.25);
    }
    // footstep noise
    if (this.grounded && Math.hypot(this.vel.x, this.vel.z) > 5) {
      this.stepT -= dt;
      if (this.stepT <= 0) {
        this.stepT = 0.5;
        sim.noise(this.pos, 14, this);
      }
    }

    // facing
    const hs = Math.hypot(this.vel.x, this.vel.z);
    let ty = this.yaw;
    if (this.grounded && hasMove) ty = Math.atan2(mv.x, mv.z);
    else if (!this.grounded && hs > 3) ty = Math.atan2(this.vel.x, this.vel.z);
    this.yaw = turnToward(this.yaw, ty, 9 * dt);
  }

  private updateGrabbed(dt: number, ctrl: ScoutControl, sim: Sim) {
    this.vel.set(0, 0, 0);
    this.hooks.forEach((_, i) => this.releaseHook(i));
    this.slashT = 0;
    if (ctrl.struggle) this.struggle += this.isPlayer ? 0.13 : 0.01; // squad mates can't free themselves
    this.struggle = Math.max(0, this.struggle - 0.06 * dt);
    this.damage((this.isPlayer ? 4 : 2) * dt, "squeeze", sim);
    if (this.struggle >= 1 && this.grabbedBy) {
      this.struggle = 0;
      this.grabbedBy.breakFree();
      if (this.isPlayer) sim.toast("You broke free!", "good");
    }
  }

  /** Update model transform + procedural animation. */
  syncModel(dt: number, sim: Sim) {
    const m = this.parts;
    this.model.position.copy(this.pos);
    if (!this.alive) return;
    m.root.rotation.y = this.yaw;
    const hs = Math.hypot(this.vel.x, this.vel.z);
    const air = !this.grounded && !this.grabbedBy;
    const lean = this.grabbedBy ? 0.1 : air ? clamp(this.speed / 38, 0, 1) * 1.15 : clamp(hs / 12, 0, 1) * 0.25;
    m.tilt.rotation.x = damp(m.tilt.rotation.x, lean, 8, dt);
    const sp = this.slashT > 0 ? 1 - this.slashT / this.slashDur : -1;
    m.tilt.rotation.z = sp >= 0 ? sp * Math.PI * 2 : 0;
    const speedF = clamp(this.speed / 30, 0, 1);

    if (m.legL && m.legR && m.armL && m.armR && m.cape) {
      if (this.grounded && hs > 1) this.walkPhase += hs * dt * 1.1;
      const sw = this.grounded ? Math.sin(this.walkPhase) * clamp(hs / 8, 0, 1) * 0.9 : 0;
      m.legL.rotation.x = air ? -0.35 : sw;
      m.legR.rotation.x = air ? 0.15 : -sw;
      m.cape.rotation.x = 0.12 + speedF * 1.0 + Math.sin(this.animT * 9) * 0.06 * (0.3 + speedF);
      let aL = -0.55 + (this.grounded ? -sw * 0.3 : 0);
      let aR = -0.55 + (this.grounded ? sw * 0.3 : 0);
      if (this.swapT > 0) {
        aL = -1.2 + Math.sin(this.animT * 20) * 0.35;
        aR = -1.0 + Math.cos(this.animT * 20) * 0.35;
      }
      if (sp >= 0) {
        const e = 1 - Math.pow(1 - clamp(sp * 1.4, 0, 1), 3);
        aR = -2.7 + 2.9 * e;
        aL = -2.4 + 2.5 * e;
      }
      if (this.grabbedBy) aL = aR = -2.8;
      m.armL.rotation.x = aL;
      m.armR.rotation.x = aR;
    }
    if (m.bladeMat && m.blades) {
      const dur = clamp(this.bladeDur / 100, 0, 1);
      m.bladeMat.color.setRGB(0.28 + dur * 0.65, 0.26 + dur * 0.65, 0.25 + dur * 0.68);
      m.bladeMat.emissiveIntensity = 0.1 + dur * 0.4;
      const swapping = this.swapT > 0;
      for (const b of m.blades) {
        b.visible = !(swapping && this.swapT > 0.5);
        b.scale.z = this.bladeDur <= 0 ? 0.25 : 0.4 + dur * 0.6;
        b.position.z = 0.15 + 0.57 * b.scale.z;
      }
    }

    // gas jets
    if (this.boosting) {
      this.jetT -= dt;
      if (this.jetT <= 0) {
        this.jetT = 0.025;
        fwdOf(this.yaw, _f);
        rightOf(this.yaw, _r);
        const back = _u.copy(this.lastBoostDir).multiplyScalar(-1);
        for (const s of [-1, 1]) {
          _t.set(
            this.pos.x + _r.x * 0.32 * s - _f.x * 0.3,
            this.pos.y - 0.2,
            this.pos.z + _r.z * 0.32 * s - _f.z * 0.3
          );
          sim.fx.gasJet(_t, back);
        }
      }
    }
    // slash sparkle trail
    if (sp >= 0) {
      fwdOf(this.yaw, _f);
      for (let i = 0; i < 2; i++) {
        _t.set(this.pos.x + _f.x * (1 + Math.random() * 1.5), this.pos.y + (Math.random() - 0.3) * 1.2, this.pos.z + _f.z * (1 + Math.random() * 1.5));
        _u.set(0, 0, 0);
        sim.fx.particles.emit(_t, _u, [1, 1, 1], 0.8, 0.35, 0.22, 0, 0, -0.6);
      }
    }
  }

  // ---- called by titans -----------------------------------------------------------------
  /** Hide/show helper for grabbed state so the model can be posed in a titan's hand. */
  setGrabbed(t: Titan | null) {
    this.grabbedBy = t;
    if (t) {
      this.hooks.forEach((_, i) => this.releaseHook(i));
      this.vel.set(0, 0, 0);
      this.struggle = 0;
    }
  }
}
