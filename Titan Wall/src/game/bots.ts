import { V3, clamp, rand, pick, relativeDir } from "./math";
import { Scout, newControl, clearControl } from "./scout";
import type { ScoutControl } from "./scout";
import type { Sim, BarkKey } from "./types";
import type { Titan } from "./titan";
import { MAP_R } from "./lore";

export type BotKind = "veteran" | "hothead" | "rookie" | "lancer" | "sentinel";
export type BotState =
  | "follow"
  | "hesitate"
  | "approach"
  | "dive"
  | "recover"
  | "resupply"
  | "rescue"
  | "panic"
  | "evade"
  | "grabbed"
  | "dead";

export interface Personality {
  kind: BotKind;
  name: string;
  title: string;
  color: string;
  cruiseAlt: number;
  gasFloor: number; // won't cruise-boost below this
  diveGasFloor: number;
  swapAt: number; // swap blades at/below this durability
  resupplyGas: number;
  hesitation: [number, number];
  panicRadius: number;
  mistime: number;
  evade: boolean;
  rescueChance: number;
  /** 0 (never confident) to 1 (fights on regardless of wounds). */
  bravery: number;
  /** Retreat to a depot when HP falls below this fraction of max, unless confident of the kill. */
  retreatAt: number;
  w: { ally: number; size: number; near: number; distracted: number; abnormal: number; spread: number };
}

export const PERSONALITIES: Record<BotKind, Personality> = {
  veteran: {
    kind: "veteran",
    name: "Harlan",
    title: "The Veteran",
    color: "#7fb3ff",
    cruiseAlt: 15,
    gasFloor: 40,
    diveGasFloor: 22,
    swapAt: 45,
    resupplyGas: 25,
    hesitation: [0, 0],
    panicRadius: 0,
    mistime: 0,
    evade: true,
    rescueChance: 1,
    bravery: 0.7,
    retreatAt: 0.35,
    w: { ally: 5, size: 0.05, near: 2, distracted: 0.8, abnormal: 0.5, spread: 1.5 },
  },
  hothead: {
    kind: "hothead",
    name: "Vex",
    title: "The Hothead",
    color: "#ff7a4d",
    cruiseAlt: 10,
    gasFloor: 0,
    diveGasFloor: 0,
    swapAt: 12,
    resupplyGas: 4,
    hesitation: [0, 0],
    panicRadius: 0,
    mistime: 0.02,
    evade: false,
    rescueChance: 0.35,
    bravery: 0.9,
    retreatAt: 0.2,
    w: { ally: 0.5, size: 1.2, near: 1, distracted: 0, abnormal: 0, spread: 0 },
  },
  rookie: {
    kind: "rookie",
    name: "Pip",
    title: "The Nervous Rookie",
    color: "#e8d95a",
    cruiseAlt: 24,
    gasFloor: 30,
    diveGasFloor: 15,
    swapAt: 55,
    resupplyGas: 35,
    hesitation: [1.6, 3.8],
    panicRadius: 17,
    mistime: 0.3,
    evade: true,
    rescueChance: 1,
    bravery: 0.2,
    retreatAt: 0.5,
    w: { ally: 1, size: -0.35, near: 1.2, distracted: 4, abnormal: -4, spread: 2 },
  },
  lancer: {
    kind: "lancer",
    name: "Bram",
    title: "The Steady Lancer",
    color: "#c58bff",
    cruiseAlt: 18,
    gasFloor: 35,
    diveGasFloor: 18,
    swapAt: 50,
    resupplyGas: 28,
    hesitation: [0.2, 0.8],
    panicRadius: 9,
    mistime: 0.05,
    evade: true,
    rescueChance: 0.9,
    bravery: 0.75,
    retreatAt: 0.3,
    w: { ally: 3, size: 0.2, near: 1.6, distracted: 1.2, abnormal: 0.8, spread: 1.6 },
  },
  sentinel: {
    kind: "sentinel",
    name: "Oda",
    title: "The Cautious Sentinel",
    color: "#7ad1b5",
    cruiseAlt: 28,
    gasFloor: 45,
    diveGasFloor: 25,
    swapAt: 40,
    resupplyGas: 30,
    hesitation: [0.6, 1.4],
    panicRadius: 14,
    mistime: 0.1,
    evade: true,
    rescueChance: 0.6,
    bravery: 0.4,
    retreatAt: 0.45,
    w: { ally: 2, size: -0.1, near: 1.3, distracted: 2.2, abnormal: -0.5, spread: 2.2 },
  },
};

// ------------------------------------------------------------------------------------ dialogue
type Lines = Partial<Record<BarkKey, string[]>>;
export const LINES: Record<BotKind, Lines> = {
  veteran: {
    wave_start: ["Eyes up, everyone. Hold formation.", "Wave {wave}. Conserve gas and pick your cuts."],
    spot_titan: ["Titan {dir}, {height} meters. Mind your flank."],
    spot_abnormal: ["Abnormal! It moves wrong — stay off the ground!", "Abnormal sighted. Don't let it jump you."],
    threat_player: [
      "Watch your {side} flank, rookie—don't waste your gas.",
      "Titan {dir}, {height} meters. Move!",
      "It's locked on you. Break {side}!",
    ],
    player_low_gas: ["Your gas is at {gas}%. Swing, don't burn it.", "Watch your gas, rookie—it's a long fight."],
    player_low_blades: ["Blades are dull. Swap them before you commit.", "Check your blades, rookie."],
    player_hurt: ["You're hurt. Fall back to a depot if you need to."],
    kill: ["Clean cut.", "One strike. That's all it takes.", "Down. Next."],
    praise: ["Good cut.", "Nice work, rookie."],
    ally_grabbed: ["{name} is grabbed — I'm moving in!", "{name} is down! Flank it, now!"],
    grabbed: ["Not... like this...", "Tch— my mistake..."],
    rescued: ["Thanks. I owe you one."],
    thanks: ["Good work. Back to it."],
    out_of_gas: ["Gas is dry. Pulling back to resupply."],
    blades_broken: ["Blades are gone. Swapping."],
    resupply: ["Resupplying. Cover me."],
    crash: ["Misjudged that one."],
    flank: ["Flanking. {name}, keep it busy.", "I'll take its blind side. Hold its attention."],
    dive: ["Going in. Nape, clean."],
    wave_clear: ["Area clear. Regroup and resupply."],
    reinforce: ["Back in formation."],
    rescue_go: ["Hold on, {name}! Flanking now!"],
    idle: ["Stay sharp. They never stop coming."],
  },
  hothead: {
    wave_start: ["Finally! Bring 'em on!", "Wave {wave}? Is that all?!"],
    spot_abnormal: ["An Abnormal? Good, I was getting bored!"],
    rush: ["Out of my way, that {height}-meter is mine!", "That {height}-meter's mine! Don't get in my way!", "I'm taking the big one!"],
    kill: ["HAH! Next!", "Is that all you've got?!", "One cut! Who's next?!"],
    praise: ["Not bad. I'm still getting the next one."],
    ally_grabbed: ["Tch—{name}, you idiot!", "{name}! Hang on — I'm not done with this one!"],
    grabbed: ["Let go of me, you ugly brute!!", "Get your hands off— AARGH!"],
    rescued: ["I had it! ...Thanks."],
    thanks: ["Don't think this makes us even."],
    out_of_gas: ["Out of gas?! Dammit!", "Tch—tank's empty!"],
    blades_broken: ["My blades—! Useless!"],
    resupply: ["Refilling. Don't touch my kill!"],
    crash: ["Ow— that wall came out of nowhere!"],
    dive: ["Right through the neck!", "Die already!"],
    wave_clear: ["That's it? I'm just getting started."],
    reinforce: ["I'm back. Did I miss anything?"],
    rescue_go: ["I'll cut it down — hang on, {name}!"],
    idle: ["Where are they? I'm itching for a fight."],
  },
  rookie: {
    wave_start: ["T-there's too many of them!", "W-wave {wave}... okay... okay."],
    spot_titan: ["A titan! {dir}... it's so big!"],
    spot_abnormal: ["A-abnormal?! It's moving wrong!"],
    threat_player: ["Behind you! Behind you!", "It's coming for you!"],
    player_low_gas: ["Y-your gas is low... you should refill!"],
    hesitate: ["Okay... okay, I can do this...", "T-there's too many of them!", "Wait for the right moment... wait..."],
    panic: ["It's too close! It's too close!", "Aaah— stay back!", "Wrong way, wrong way—!"],
    crash: ["Ow—my hook missed!", "Ugh... wrong roof...", "I-I'm okay! I'm okay!"],
    ally_grabbed: ["{name}! Hold on, I'm coming!", "No, no— {name}! I'm coming!"],
    rescue_go: ["T-there's too many of them! Hold on, I'm coming!", "Hold on, {name}! I'm coming!"],
    grabbed: ["Help! Somebody help me!!", "Please! Please don't—!"],
    rescued: ["Y-you saved me... thank you!"],
    thanks: ["Th-thank you!"],
    kill: ["I... I did it?! I killed one!", "Did you see that?!"],
    praise: ["Wow, that was amazing!"],
    out_of_gas: ["I'm out of gas! What do I do?!"],
    blades_broken: ["M-my blades broke!"],
    resupply: ["Going to resupply! Be right back!"],
    dive: ["Now! N-now!"],
    wave_clear: ["We... we made it?"],
    reinforce: ["S-sorry I'm late!"],
    idle: ["Is it... is it over?"],
  },
  lancer: {
    wave_start: ["Wave {wave}. Stay close and cut clean.", "Keep your blades sharp."],
    spot_titan: ["Titan, {dir}. Hold the line."],
    spot_abnormal: ["Abnormal. Watch its legs."],
    threat_player: ["Behind you — move!"],
    player_low_gas: ["Gas is low. Resupply when you can."],
    hesitate: ["Steady.", "Wait for the opening."],
    panic: ["Back off, back off!"],
    crash: ["Landed badly. Still moving."],
    ally_grabbed: ["{name} is held! Cutting in."],
    rescue_go: ["On my way, {name}."],
    grabbed: ["Get me out of here!"],
    rescued: ["Good. Stay with me."],
    thanks: ["Thanks. Owe you one."],
    kill: ["Nape cut. Next."],
    praise: ["Clean work."],
    out_of_gas: ["Out of gas."],
    blades_broken: ["Blades gone. Swapping."],
    resupply: ["Pulling back to the depot."],
    dive: ["Going in."],
    wave_clear: ["Clear. Reload."],
    reinforce: ["Back in the fight."],
    idle: ["Quiet... for now."],
  },
  sentinel: {
    wave_start: ["Wave {wave}. Keep your distance from the big ones.", "Count the titans first."],
    spot_titan: ["Titan {dir}, about {height} metres."],
    spot_abnormal: ["Abnormal! Keep moving, don't stop."],
    threat_player: ["Something's on you — break left!"],
    player_low_gas: ["Your gas is low. Get to a depot."],
    hesitate: ["Not yet...", "Let it come to us."],
    panic: ["Too close! Pulling out!"],
    crash: ["Ugh — roof was rotten."],
    ally_grabbed: ["{name} is taken. Hold position, I'll cover."],
    rescue_go: ["I'll try for {name}. Don't do anything stupid."],
    grabbed: ["Somebody... please..."],
    rescued: ["Thank the walls, you're free."],
    thanks: ["Thanks."],
    kill: ["Down. Breathing again."],
    praise: ["Good cut."],
    out_of_gas: ["No gas left!"],
    blades_broken: ["Blades broken. Swapping now."],
    resupply: ["Falling back to resupply. Hurt."],
    dive: ["Going for it."],
    wave_clear: ["It's clear. Hold on."],
    reinforce: ["Ready when you are."],
    idle: ["Still watching the gap."],
  },
};

export function formatBark(kind: BotKind, key: BarkKey, vars: Record<string, string | number> = {}): string | null {
  const arr = LINES[kind][key];
  if (!arr || !arr.length) return null;
  return pick(arr).replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? "?"));
}

export function stateLabel(kind: BotKind, st: BotState): string {
  switch (st) {
    case "follow":
      return kind === "rookie" ? "Perched" : "Formation";
    case "hesitate":
      return "Hesitating...";
    case "approach":
      return kind === "veteran" ? "Flanking" : kind === "hothead" ? "CHARGING" : "Closing in";
    case "dive":
      return "Striking";
    case "recover":
      return "Disengaging";
    case "resupply":
      return "Resupplying";
    case "rescue":
      return "RESCUING";
    case "panic":
      return "PANICKING";
    case "evade":
      return "Evading";
    case "grabbed":
      return "GRABBED!";
    default:
      return "KIA";
  }
}

// ------------------------------------------------------------------------------------ brain
interface SteerOpts {
  alt: number;
  boost: "none" | "cruise" | "always";
  gasFloor?: number;
  arrive?: number;
  mistime?: number;
  hang?: boolean;
  cruiseSpeed?: number;
}

const _to = new V3();
const _dirH = new V3(0, 0, 1);
const _tgt = new V3();
const _look = new V3();
const _ta = new V3();
const _o = new V3();
const _p = new V3();
const _d = new V3();
const _best = new V3();
const _h = new V3();
const _stage = new V3();
const _away = new V3();

export class BotBrain {
  readonly ctrl: ScoutControl = newControl();
  state: BotState = "follow";
  st = 0;
  target: Titan | null = null;
  peers: BotBrain[] = [];
  player!: Scout;

  private dt = 0.016;
  private path: V3[] = [];
  private pathI = 0;
  private repathT = 0;
  private hookT: [number, number] = [0, 0];
  private chooseT = Math.random();
  private panicT = 0;
  private hesT = 0;
  private flankSide = Math.random() < 0.5 ? -1 : 1;
  private avoidAlt = 0;
  private avoidT = 0;
  private wallT = 0;
  private wallN = new V3();
  private stuckT = 0;
  private kickT = 0;
  private slashed = false;
  private perchT = 0;
  private perchPt = new V3();
  private struggleT = 0;
  private calloutT = 4;
  private rescueRolled = new Set<number>();
  private rescueTitan: Titan | null = null;
  private groundT = 0;
  private arrived = false;

  constructor(readonly scout: Scout, readonly P: Personality) {}

  respawn() {
    this.state = "follow";
    this.st = 0;
    this.target = null;
    this.path = [];
    this.panicT = 0;
    this.kickT = 0;
    this.rescueTitan = null;
  }

  private bark(sim: Sim, key: BarkKey, vars?: Record<string, string | number>) {
    sim.bark(this.scout, key, vars);
  }
  private set(state: BotState) {
    this.state = state;
    this.st = 0;
    this.slashed = false;
    this.path = [];
    this.pathI = 0;
  }

  // ---------------------------------------------------------------- main think
  think(dt: number, sim: Sim): ScoutControl {
    const s = this.scout;
    const c = this.ctrl;
    const P = this.P;
    clearControl(c);
    this.dt = dt;
    if (!s.alive) {
      this.state = "dead";
      return c;
    }
    this.st += dt;
    this.chooseT -= dt;
    this.hookT[0] -= dt;
    this.hookT[1] -= dt;
    this.avoidT -= dt;
    this.kickT -= dt;
    this.perchT -= dt;
    this.calloutT -= dt;

    if (s.grabbedBy) {
      if (this.state !== "grabbed") {
        this.set("grabbed");
        this.bark(sim, "grabbed");
      }
      this.struggleT -= dt;
      if (this.struggleT <= 0) {
        this.struggleT = rand(0.3, 0.55);
        c.struggle = true;
      }
      return c;
    }
    if (this.state === "grabbed" || this.state === "dead") this.set("recover");
    if (s.stun > 0) return c;

    // stuck detection (not when intentionally waiting)
    if (s.speed < 2 && !this.arrived && this.state !== "hesitate") this.stuckT += dt;
    else this.stuckT = 0;
    if (this.stuckT > 3) {
      this.stuckT = 0;
      this.kickT = 1.2;
    }
    this.groundT = s.grounded ? this.groundT + dt : 0;

    // blade swap
    if (s.swapT <= 0 && s.spare > 0 && s.slashT <= 0 && s.bladeDur <= P.swapAt && (this.state !== "dive" || s.bladeDur <= 0)) c.swap = true;

    // resupply triggers
    const noBlades = s.bladeDur <= 0 && s.spare <= 0;
    const lowGas = s.gas < P.resupplyGas;
    if ((lowGas || noBlades) && this.state !== "resupply" && this.state !== "panic" && !(this.state === "rescue" && s.gas > 0)) {
      this.set("resupply");
      this.target = null;
      this.bark(sim, s.gas < 10 ? "out_of_gas" : "resupply");
    }

    // wounded: fall back to a depot, unless this bot is sure of a kill (brave bots fight on longer)
    const wounded = s.hp < s.maxHp * P.retreatAt;
    const sureOfKill = !!this.target && this.target.alive && this.target.hp <= 40 && P.bravery >= 0.5 && s.bladeDur > 30;
    if (wounded && !sureOfKill && this.state !== "resupply" && this.state !== "panic" && this.state !== "rescue" && !s.grabbedBy) {
      this.set("resupply");
      this.target = null;
      this.bark(sim, "resupply");
    }

    // rescue trigger
    if (this.state !== "rescue" && this.state !== "resupply" && this.state !== "panic") this.checkRescue(sim);

    // rookie panic
    if (P.kind === "rookie" && this.state !== "panic" && this.state !== "rescue" && this.state !== "resupply") {
      const th = this.nearestThreat(sim, P.panicRadius);
      if (th) {
        this.set("panic");
        this.panicT = rand(1.5, 2.6);
        this.target = null;
        this.bark(sim, "panic");
      }
    }

    // evasion of an imminent strike
    if (P.evade && this.state !== "panic" && this.state !== "rescue" && this.state !== "resupply") {
      const th = this.imminentStrike(sim);
      if (th) {
        if (this.state !== "evade") this.set("evade");
        this.st = 0;
      }
    }

    this.arrived = false;
    switch (this.state) {
      case "follow":
        this.doFollow(sim);
        break;
      case "hesitate":
        this.doHesitate(sim);
        break;
      case "approach":
        this.doApproach(sim);
        break;
      case "dive":
        this.doDive(sim, false);
        break;
      case "rescue":
        this.doRescue(sim);
        break;
      case "recover":
        this.doRecover(sim);
        break;
      case "resupply":
        this.doResupply(sim);
        break;
      case "panic":
        this.doPanic(sim);
        break;
      case "evade":
        this.doEvade(sim);
        break;
    }

    if (P.kind === "veteran" || P.kind === "rookie") this.callouts(sim);
    return c;
  }

  // ---------------------------------------------------------------- awareness
  private callouts(sim: Sim) {
    if (this.calloutT > 0) return;
    const pl = this.player;
    if (!pl.alive) return;
    for (const t of sim.titans) {
      if (!t.alive || t.target !== pl || t.state === "wander") continue;
      const d = Math.hypot(t.pos.x - pl.pos.x, t.pos.z - pl.pos.z);
      if (d > 45) continue;
      const dir = relativeDir(pl.pos, pl.yaw, t.pos);
      const side = dir.includes("left") ? "left" : dir.includes("right") ? "right" : dir.includes("behind") ? "rear" : "front";
      this.calloutT = rand(9, 14);
      this.bark(sim, "threat_player", { dir, side, height: Math.round(t.height) });
      return;
    }
    if (this.P.kind === "veteran" || Math.random() < 0.5) {
      if (pl.gas < 22) {
        this.calloutT = rand(18, 26);
        this.bark(sim, "player_low_gas", { gas: Math.round(pl.gas) });
        return;
      }
      if (this.P.kind === "veteran" && pl.bladeDur < 25 && pl.spare === 0) {
        this.calloutT = rand(18, 26);
        this.bark(sim, "player_low_blades");
        return;
      }
    }
    this.calloutT = 1.5;
  }

  private nearestThreat(sim: Sim, radius: number): Titan | null {
    const s = this.scout;
    let best: Titan | null = null;
    let bd = radius;
    for (const t of sim.titans) {
      if (!t.alive) continue;
      const d = Math.hypot(t.pos.x - s.pos.x, t.pos.z - s.pos.z);
      if (d < bd && s.pos.y < t.height * 1.3 + 4 && (t.target === s || d < radius * 0.6) && t.state !== "eating") {
        bd = d;
        best = t;
      }
    }
    return best;
  }

  private imminentStrike(sim: Sim): Titan | null {
    const s = this.scout;
    for (const t of sim.titans) {
      if (!t.alive || (t.state !== "windup" && t.state !== "leap")) continue;
      if (t.target !== s && t.state !== "leap") continue;
      const d = Math.hypot(t.pos.x - s.pos.x, t.pos.z - s.pos.z);
      if (d < t.reach + 7 && s.pos.y < t.height * 1.2 + 3) {
        // veterans won't abandon a strike that's already at slash range
        if (this.state === "dive" && this.target === t && this.P.kind === "veteran" && s.pos.distanceTo(t.nape) < t.napeR + 6) continue;
        return t;
      }
    }
    return null;
  }

  private checkRescue(sim: Sim) {
    const s = this.scout;
    const P = this.P;
    for (const o of sim.scouts) {
      if (o === s || !o.alive || !o.grabbedBy) continue;
      const t = o.grabbedBy;
      if (!t.alive) continue;
      if (!this.rescueRolled.has(t.id)) {
        this.rescueRolled.add(t.id);
        if (Math.random() > P.rescueChance) continue;
      } else if (P.rescueChance < 1) continue;
      if (this.state === "dive" && this.target === t) {
        this.rescueTitan = t;
        this.set("rescue");
        return;
      }
      this.rescueTitan = t;
      this.target = t;
      this.set("rescue");
      this.bark(sim, "rescue_go", { name: o.name });
      return;
    }
  }

  private chooseTarget(sim: Sim): Titan | null {
    const s = this.scout;
    const P = this.P;
    let best: Titan | null = null;
    let bs = -1e9;
    for (const t of sim.titans) {
      if (!t.alive) continue;
      const d = Math.hypot(t.pos.x - s.pos.x, t.pos.z - s.pos.z);
      if (P.kind === "rookie" && d < P.panicRadius * 1.3) continue;
      const tgt = t.target;
      let score = 0;
      score += P.w.ally * (tgt && tgt !== s && tgt.alive ? 1 : 0);
      score += P.w.size * t.height;
      score += P.w.near * (1 - clamp(d / 150, 0, 1)) * 5;
      score += P.w.distracted * (t.state === "eating" || t.state === "windup" || t.state === "recover" ? 1 : tgt && tgt !== s ? 0.5 : 0);
      if (t.abnormal) score += P.w.abnormal;
      if (P.kind === "rookie" && tgt === s) score -= 8;
      for (const b of this.peers) if (b !== this && b.target === t && b.scout.alive) score -= P.w.spread;
      if (score > bs) {
        bs = score;
        best = t;
      }
    }
    return best;
  }

  // ---------------------------------------------------------------- states
  private perch(sim: Sim): V3 {
    if (this.perchT > 0) return this.perchPt;
    this.perchT = 3;
    let top = -1;
    const pl = this.player.pos;
    let bx = pl.x;
    let bz = pl.z;
    for (const b of sim.world.boxes) {
      if (b.kind === "wall") continue;
      const cx = (b.minX + b.maxX) / 2;
      const cz = (b.minZ + b.maxZ) / 2;
      if (Math.hypot(cx - pl.x, cz - pl.z) > 55) continue;
      if (b.y1 > top) {
        top = b.y1;
        bx = cx;
        bz = cz;
      }
    }
    this.perchPt.set(bx + rand(-2, 2), Math.max(top, 0) + 1, bz + rand(-2, 2));
    return this.perchPt;
  }

  private doFollow(sim: Sim) {
    const s = this.scout;
    const c = this.ctrl;
    const P = this.P;
    const pl = this.player;
    const fy = pl.yaw;
    let dest: V3;
    if (P.kind === "rookie") {
      dest = this.perch(sim);
    } else {
      const side = P.kind === "veteran" ? -1 : 1;
      const back = P.kind === "veteran" ? -10 : 6;
      dest = _stage.set(pl.pos.x + Math.sin(fy) * back + Math.cos(fy) * -side * 9, 1, pl.pos.z + Math.cos(fy) * back + Math.sin(fy) * side * 9);
    }
    const dist = Math.hypot(dest.x - s.pos.x, dest.z - s.pos.z);
    this.arrived = dist < 6 && s.grounded;
    this.steer(sim, dest, {
      alt: P.kind === "rookie" ? dest.y + 3 : P.cruiseAlt,
      boost: P.kind === "hothead" ? "cruise" : "cruise",
      gasFloor: P.gasFloor + 20,
      arrive: 7,
      mistime: P.mistime * 0.3,
      cruiseSpeed: 16,
    });
    if (dist < 7) {
      c.move.multiplyScalar(0.2);
      c.boost = false;
      if (s.grounded) c.hold[0] = c.hold[1] = false;
    }

    if (this.chooseT <= 0) {
      this.chooseT = 0.8 + Math.random() * 0.4;
      const t = this.chooseTarget(sim);
      if (t) this.engage(sim, t);
    }
  }

  private engage(sim: Sim, t: Titan) {
    const P = this.P;
    this.target = t;
    this.flankSide = Math.random() < 0.5 ? -1 : 1;
    if (P.kind === "rookie") {
      this.set("hesitate");
      this.hesT = rand(P.hesitation[0], P.hesitation[1]);
      this.bark(sim, "hesitate");
    } else if (P.kind === "hothead") {
      this.set("approach");
      this.bark(sim, "rush", { height: Math.round(t.height) });
    } else {
      this.set("approach");
      const ally = t.target && t.target !== this.scout ? t.target.name : this.player.name;
      this.bark(sim, "flank", { name: ally });
    }
  }

  private doHesitate(sim: Sim) {
    const s = this.scout;
    const t = this.target;
    if (!t || !t.alive) {
      this.target = null;
      this.set("follow");
      return;
    }
    this.hesT -= this.dt;
    const dest = this.perch(sim);
    this.arrived = true;
    this.steer(sim, dest, { alt: dest.y + 3, boost: "none", arrive: 7, hang: true, mistime: 0 });
    this.ctrl.move.multiplyScalar(0.2);
    if (this.hesT <= 0) {
      this.set("approach");
      this.bark(sim, "dive");
    }
    void s;
  }

  private stagePoint(t: Titan): V3 {
    const k = this.P.kind;
    const fx = Math.sin(t.yaw);
    const fz = Math.cos(t.yaw);
    const nape = t.nape;
    if (k === "hothead") return _stage.copy(nape);
    if (k === "veteran") {
      const rx = -fz; // titan's right (x,z) = (-cos, sin)... use perpendicular to forward
      const rz = fx;
      return _stage.set(nape.x - fx * 15 + rx * this.flankSide * 10, nape.y + 3, nape.z - fz * 15 + rz * this.flankSide * 10);
    }
    return _stage.set(nape.x - fx * 18, Math.max(nape.y + 8, 20), nape.z - fz * 18);
  }

  private losToNape(sim: Sim, t: Titan) {
    return !sim.world.segmentBlocked(this.scout.pos, t.nape);
  }

  private doApproach(sim: Sim) {
    const s = this.scout;
    const P = this.P;
    const t = this.target;
    if (!t || !t.alive) {
      this.target = null;
      this.set("follow");
      return;
    }
    const stage = this.stagePoint(t);
    const d = s.pos.distanceTo(t.nape);
    const fx = Math.sin(t.yaw);
    const fz = Math.cos(t.yaw);
    const behind = (s.pos.x - t.nape.x) * fx + (s.pos.z - t.nape.z) * fz < 4;
    const los = d < 60 && this.losToNape(sim, t);
    const diveRange = P.kind === "hothead" ? 70 : P.kind === "veteran" ? 28 : 30;
    if (los && d < diveRange && (behind || P.kind === "hothead")) {
      this.set("dive");
      if (P.kind !== "hothead") this.bark(sim, "dive");
      return;
    }
    const ho = P.kind === "hothead";
    this.steer(sim, stage, {
      alt: ho ? stage.y : P.kind === "rookie" ? Math.max(stage.y, 20) : stage.y,
      boost: ho ? "always" : "cruise",
      gasFloor: P.kind === "veteran" ? P.gasFloor : P.kind === "rookie" ? P.gasFloor : 0,
      arrive: 5,
      mistime: P.mistime,
      cruiseSpeed: ho ? 40 : 18,
    });
    if (this.st > 22) {
      this.target = null;
      this.set("follow");
    }
  }

  private doRescue(sim: Sim) {
    const t = this.rescueTitan;
    if (!t || !t.alive || !t.grabbed) {
      this.rescueTitan = null;
      this.target = null;
      this.set("recover");
      return;
    }
    this.target = t;
    this.doDive(sim, true);
  }

  private doDive(sim: Sim, urgent: boolean) {
    const s = this.scout;
    const c = this.ctrl;
    const P = this.P;
    const t = this.target;
    if (!t || !t.alive) {
      this.target = null;
      this.set("recover");
      return;
    }
    const nape = t.nape;
    _to.subVectors(nape, s.pos);
    const d = _to.length();
    const los = this.losToNape(sim, t);
    const rushing = P.kind === "hothead" || (urgent && P.kind === "rookie");
    const floor = P.kind === "hothead" || (urgent && P.kind === "rookie") ? 0 : urgent ? 10 : P.diveGasFloor;

    if (!los && d > 8) {
      // blocked — navigate around buildings toward the nape
      this.steer(sim, nape, {
        alt: nape.y + 2,
        boost: rushing ? "always" : "cruise",
        gasFloor: floor,
        arrive: 3,
        mistime: urgent ? 0 : P.mistime,
        cruiseSpeed: 30,
      });
    } else {
      // direct dive: hook the titan and burn toward the nape
      for (let side = 0; side < 2; side++) {
        const h = s.hooks[side];
        if (h.state === "attached") {
          c.hold[side] = d > 4.5 || !h.titan;
        } else if (h.state === "flying") c.hold[side] = true;
        else if (this.hookT[side] <= 0 && h.cooldown <= 0 && d > 6 && d < 62 && los) {
          s.handPos(side, _h);
          _d.subVectors(nape, _h).normalize();
          if (P.mistime > 0 && !urgent) {
            _d.x += rand(-1, 1) * P.mistime * 0.15;
            _d.y += rand(-1, 1) * P.mistime * 0.15;
            _d.normalize();
          }
          c.fire[side] = _d.clone();
          c.hold[side] = true;
          this.hookT[side] = 0.3 + side * 0.15;
        }
      }
      const attached = s.hooks.some((h) => h.state === "attached");
      c.reel = attached && d > t.napeR + 3;
      const closing = (s.vel.x * _to.x + s.vel.y * _to.y + s.vel.z * _to.z) / Math.max(0.01, d);
      const needSpeed = closing < 14 || s.speed < s.killSpeed + 7 || rushing;
      c.boost = s.gas > floor && s.gas > 0 && needSpeed && d > 4.5;
      c.boostDir.copy(_to).divideScalar(Math.max(0.01, d));
      c.move.set(_to.x, 0, _to.z).normalize().multiplyScalar(0.7);
    }

    // slash when the nape is inside blade reach
    const reach = t.napeR + 2.7;
    if (d < reach && s.slashT <= 0 && s.hasBlades) {
      if (s.speed >= s.killSpeed * 0.95 || rushing || this.st > 3.2) {
        c.slash = true;
        this.slashed = true;
      }
    }
    if (this.slashed && s.slashT <= 0 && !urgent) {
      this.set("recover");
      return;
    }
    if (this.st > (urgent ? 14 : 7)) {
      this.set(urgent ? "recover" : "approach");
      return;
    }
    if (!urgent && d > 90) this.set("approach");
  }

  private doRecover(sim: Sim) {
    const s = this.scout;
    const base = this.target && this.target.alive ? this.target.pos : null;
    if (base) _away.set(s.pos.x - base.x, 0, s.pos.z - base.z);
    else _away.set(s.vel.x, 0, s.vel.z);
    if (_away.lengthSq() < 0.01) _away.set(Math.sin(s.yaw), 0, Math.cos(s.yaw));
    _away.normalize();
    const dest = _stage.set(s.pos.x + _away.x * 26, 12, s.pos.z + _away.z * 26);
    this.steer(sim, dest, { alt: 15, boost: "none", arrive: 5, mistime: this.P.mistime * 0.4 });
    if (this.st > 1.4) {
      this.target = null;
      this.set("follow");
    }
  }

  private doResupply(sim: Sim) {
    const s = this.scout;
    const c = this.ctrl;
    const dep = sim.world.nearestDepot(s.pos);
    const dist = Math.hypot(dep.pos.x - s.pos.x, dep.pos.z - s.pos.z);
    if (dist < dep.radius - 1 && s.pos.y < 4) {
      this.arrived = true;
      c.move.set(0, 0, 0);
      // leave only when restocked AND mostly healed; the timeout stops a stuck bot from waiting forever
      const healed = s.hp >= s.maxHp * 0.9;
      if ((s.gas >= 92 && s.spare >= 3 && s.bladeDur >= 60 && healed) || this.st > 40) {
        this.set("follow");
        this.chooseT = 0.5;
      }
      return;
    }
    this.steer(sim, _stage.set(dep.pos.x, 1, dep.pos.z), {
      alt: dist > 40 ? 10 : 2,
      boost: "none",
      arrive: 3,
      mistime: this.P.mistime * 0.3,
    });
    // last-gasp boost home for the hothead when there is gas
    if (this.P.kind === "hothead" && s.gas > 5 && dist > 30) c.boost = true;
  }

  private doPanic(sim: Sim) {
    const s = this.scout;
    this.panicT -= this.dt;
    const th = this.nearestThreat(sim, 40);
    if (th) _away.set(s.pos.x - th.pos.x, 0, s.pos.z - th.pos.z);
    else _away.set(s.vel.x, 0, s.vel.z);
    if (_away.lengthSq() < 0.01) _away.set(rand(-1, 1), 0, rand(-1, 1));
    _away.normalize();
    const dest = _stage.set(s.pos.x + _away.x * 30, 26, s.pos.z + _away.z * 30);
    this.steer(sim, dest, {
      alt: 26,
      boost: "always",
      gasFloor: 6,
      arrive: 4,
      mistime: this.P.mistime + 0.05,
    });
    if (this.panicT <= 0) {
      this.set("follow");
      this.chooseT = 2.5;
    }
  }

  private doEvade(sim: Sim) {
    const s = this.scout;
    let th: Titan | null = null;
    for (const t of sim.titans) {
      if (t.alive && (t.state === "windup" || t.state === "leap" || t.state === "recover" || t.state === "strike")) {
        const d = Math.hypot(t.pos.x - s.pos.x, t.pos.z - s.pos.z);
        if (d < t.reach + 9 && (t.target === s || t.state === "leap")) {
          th = t;
          break;
        }
      }
    }
    if (!th || this.st > 1.1) {
      this.set(this.target && this.target.alive ? "approach" : "follow");
      return;
    }
    _away.set(s.pos.x - th.pos.x, 0, s.pos.z - th.pos.z).normalize();
    const dest = _stage.set(s.pos.x + _away.x * 24, s.pos.y + 12, s.pos.z + _away.z * 24);
    const c = this.ctrl;
    this.steer(sim, dest, { alt: Math.max(s.pos.y + 10, th.height * 1.4), boost: "always", gasFloor: 5, arrive: 3, mistime: 0 });
    c.boostDir.set(_away.x, 0.9, _away.z).normalize();
  }

  // ---------------------------------------------------------------- locomotion
  /** ODM travel toward `dest`: picks anchors, swings, reels, boosts and routes around buildings. */
  private steer(sim: Sim, dest: V3, o: SteerOpts) {
    const s = this.scout;
    const c = this.ctrl;
    const dt = this.dt;
    let alt = o.alt;

    // look-ahead obstacle avoidance
    if (s.speed > 5) {
      _look.copy(s.vel).normalize();
      const L = clamp(s.speed * 0.8, 8, 28);
      const hit = sim.world.raycast(s.pos, _look, L);
      if (hit && hit.box) {
        const top = hit.box.y1;
        if (hit.box.kind === "wall" || top > alt + 18) {
          this.wallT = 1.1;
          this.wallN.copy(hit.normal).setY(0);
        } else if (top + 5 > alt) {
          this.avoidAlt = top + 5;
          this.avoidT = 1.3;
        }
      } else if (hit && hit.kind === "ground" && s.vel.y < -6 && s.pos.y < 12) {
        this.avoidAlt = s.pos.y + 8;
        this.avoidT = 0.8;
      }
    }
    this.wallT -= dt;
    if (this.avoidT > 0) alt = Math.max(alt, Math.min(this.avoidAlt, 40));
    if (this.kickT > 0) alt = Math.max(alt, s.pos.y + 14);

    // route through the nav grid when the straight line is walled off
    _tgt.copy(dest);
    const dist3 = _to.subVectors(dest, s.pos).length();
    this.repathT -= dt;
    const flyY = Math.max(dest.y, alt);
    _p.set(dest.x, flyY, dest.z);
    const blockedLine = dist3 > 12 && sim.world.segmentBlocked(s.pos, _p);
    if (blockedLine) {
      if (this.repathT <= 0 || this.pathI >= this.path.length) {
        this.repathT = 1.1;
        this.path = sim.world.nav.findPath(s.pos, dest, Math.max(2, alt + 0.5), 1) ?? [];
        this.pathI = 0;
      }
      while (this.pathI < this.path.length && Math.hypot(this.path[this.pathI].x - s.pos.x, this.path[this.pathI].z - s.pos.z) < 7) this.pathI++;
      if (this.pathI < this.path.length) {
        const w = this.path[this.pathI];
        _tgt.set(w.x, alt, w.z);
      }
    } else {
      this.path = [];
    }

    _to.subVectors(_tgt, s.pos);
    const dToGoal = _to.length();
    const dH = Math.hypot(_to.x, _to.z);
    if (dH > 0.05) _dirH.set(_to.x / dH, 0, _to.z / dH);
    else _dirH.set(Math.sin(s.yaw), 0, Math.cos(s.yaw));
    // steer away from walls and back in from the edge of the playable map (MAP_R, ~27 km across)
    if (this.wallT > 0) _dirH.addScaledVector(this.wallN, 1.8);
    const rr = Math.hypot(s.pos.x, s.pos.z);
    const EDGE = MAP_R - 200;
    if (rr > EDGE) {
      const k = clamp((rr - EDGE) / 200, 0, 1.5);
      _dirH.x -= (s.pos.x / rr) * k;
      _dirH.z -= (s.pos.z / rr) * k;
    }
    _dirH.normalize();
    const needUp = alt - s.pos.y;
    const hang = !!o.hang;
    const arrive = o.arrive ?? 6;

    // hooks
    let anyAttached = false;
    for (let side = 0; side < 2; side++) {
      const h = s.hooks[side];
      if (h.state === "attached") {
        anyAttached = true;
        _ta.subVectors(h.anchor, s.pos);
        const aDist = _ta.length();
        const ahead = _ta.x * _dirH.x + _ta.z * _dirH.z;
        let keep = true;
        if (!hang) {
          if (ahead < 1.5 && aDist < 45) keep = false; // anchor passed
          if (aDist < 5) keep = false;
          if (h.age > 3.4) keep = false;
          if (needUp < -6 && _ta.y > 3) keep = false;
        } else if (h.age > 9) keep = false;
        if (keep && o.mistime && Math.random() < o.mistime * dt * 0.8) keep = false; // mistimed release
        c.hold[side] = keep;
        if (!keep) this.hookT[side] = rand(0.05, 0.2);
      } else if (h.state === "flying") {
        c.hold[side] = true;
      } else if (this.hookT[side] <= 0 && h.cooldown <= 0 && (dist3 > arrive + 4 || needUp > 4 || hang)) {
        const dir = this.pickAnchor(sim, side, _dirH, alt, o.mistime ?? 0);
        if (dir) {
          c.fire[side] = dir;
          c.hold[side] = true;
          this.hookT[side] = 0.3 + side * 0.12 + Math.random() * 0.15;
        } else this.hookT[side] = 0.2;
      }
    }

    // reel + boost
    const gasOK = s.gas > (o.gasFloor ?? 0) && s.gas > 0;
    c.reel = anyAttached && (needUp > 2 || s.speed < 11) && !hang;
    let want = false;
    if (o.boost === "always") want = dToGoal > arrive;
    else if (o.boost === "cruise")
      want =
        (dToGoal > 25 || needUp > 6) &&
        s.speed < (o.cruiseSpeed ?? 14) &&
        (anyAttached || s.pos.y > 4 || (this.groundT > 0.5 && needUp > 3));
    if (this.kickT > 0) {
      want = s.gas > 3;
      c.reel = anyAttached;
    }
    c.boost = want && gasOK && !(this.wallT > 0);
    c.boostDir.copy(_to).divideScalar(Math.max(0.01, dToGoal));
    if (needUp > 3) c.boostDir.y = Math.max(c.boostDir.y, 0) + 0.55;
    else if (needUp < -3) c.boostDir.y -= 0.3;
    if (this.kickT > 0) c.boostDir.y = 1;
    c.boostDir.normalize();
    c.move.set(_dirH.x, 0, _dirH.z).multiplyScalar(dToGoal < arrive ? 0.35 : 1);
  }

  private pickAnchor(sim: Sim, side: number, dirH: V3, alt: number, mistime: number): V3 | null {
    const s = this.scout;
    const needUp = alt - s.pos.y;
    const yaw0 = Math.atan2(dirH.x, dirH.z);
    _o.set(s.pos.x, s.pos.y + 0.3, s.pos.z);
    let bestScore = -1e9;
    let found = false;
    for (let i = 0; i < 10; i++) {
      // first samples hug the heading, later ones fan out sideways (needed inside narrow streets)
      const spread = i < 4 ? 0.55 : 1.35;
      const yawOff = (i % 5 === 4 ? -1 : 1) * (side === 0 ? -1 : 1) * rand(0.03, spread);
      let pitch = needUp > 4 ? rand(0.6, 1.2) : needUp < -5 ? rand(0.05, 0.35) : rand(0.3, 0.9);
      if (mistime > 0 && Math.random() < mistime * 0.5) pitch = rand(-0.1, 0.1); // mistimed: low, into roofs/walls
      const yw = yaw0 + yawOff;
      _d.set(Math.sin(yw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yw) * Math.cos(pitch));
      const hit = sim.rayWorld(_o, _d, 60, false);
      if (!hit || hit.dist < 5) continue;
      if (hit.kind === "ground" && s.pos.y > 5) continue;
      _p.subVectors(hit.point, s.pos).normalize();
      let score = (_p.x * dirH.x + _p.z * dirH.z) * 10 + hit.dist * 0.04;
      if (needUp > 2) score += clamp(hit.point.y - s.pos.y, 0, 30) * 0.25;
      if (hit.point.y < 2) score -= 6;
      if (score > bestScore) {
        bestScore = score;
        _best.copy(_d);
        found = true;
      }
    }
    return found ? _best.clone() : null;
  }
}

export function makeBrains(scouts: Scout[], kinds: BotKind[], player: Scout, names: string[] = []): BotBrain[] {
  const brains = scouts.map((s, i) => {
    // extra recruits share a temperament but get their own name, so the HUD can tell them apart
    const base = PERSONALITIES[kinds[i]];
    const P = names[i] ? { ...base, name: names[i] } : base;
    const b = new BotBrain(s, P);
    b.player = player;
    return b;
  });
  brains.forEach((b) => (b.peers = brains));
  return brains;
}

