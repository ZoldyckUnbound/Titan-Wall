import * as THREE from "three";
import { V3, clamp, damp, rand, pick, relativeDir } from "./math";
import { World } from "./world";
import { FX } from "./fx";
import { Scout, newControl, clearControl, SCOUT_R, HOOK_RANGE } from "./scout";
import type { ScoutControl } from "./scout";
import { Titan } from "./titan";
import { Sfx } from "./audio";
import { introFor, INTRO_SECONDS, type IntroCard } from "./cutscene";
import { DAY_SEC, START_HOUR, skyLight, clockLabel, periodName } from "./daynight";
import { BotBrain, PERSONALITIES, makeBrains, formatBark, stateLabel } from "./bots";
import type { BotKind } from "./bots";
import type { Sim, RayHit, BarkKey } from "./types";
import { waveSpec, FINAL_WAVE } from "./waves";
import { BASE_STATS, applyLoadout } from "./perks";
import type { BaseStats } from "./perks";
import { Music } from "./music";
import type { SpawnSpec, SpawnKind } from "./waves";
import { MARIA_R, ROSE_R, SINA_R, MAP_R, SHIG_GATE, DISTRICTS, DEPOTS, wallRingAt } from "./lore";

/** A depot is out of order while a titan is this close (game units). */
const DEPOT_LOCK_R = 45;
/** Passive regeneration only ticks above this HP, and it is slow (see healing()). Depots heal at any HP. */
const HEAL_FLOOR = 75;
/** Where wave-10's outside titans gather, south of Wall Maria at Shiganshina. */
const OUTSIDE_HOME = { x: 0, z: MARIA_R + 230 };
const KICK_WINDUP = 2.6;

export type Phase = "menu" | "playing" | "paused" | "dead" | "won";

export interface BarkMsg {
  id: number;
  who: string;
  title: string;
  color: string;
  text: string;
  key: BarkKey;
}
export interface ToastMsg {
  id: number;
  text: string;
  kind: "info" | "good" | "bad" | "kill";
}
export interface SquadStat {
  id: string;
  name: string;
  title: string;
  color: string;
  hp: number;
  maxHp: number;
  gas: number;
  alive: boolean;
  label: string;
  kills: number;
  alert: boolean;
}
export interface Snapshot {
  phase: Phase;
  hp: number;
  maxHp: number;
  gas: number;
  blade: number;
  spare: number;
  spears: number;
  swap: number;
  speed: number;
  killSpeed: number;
  wave: number;
  titansLeft: number;
  kills: number;
  napeKills: number;
  score: number;
  waveClear: boolean;
  waveTimer: number;
  clock: string;
  period: string;
  horses: number;
  mounted: boolean;
  intro: { kicker: string; title: string; body: string; forecast: string; left: number } | null;
  mapOpen: boolean;
  grabbed: boolean;
  struggle: number;
  eatProgress: number;
  squad: SquadStat[];
  hooks: [string, string];
  aim: "none" | "hook" | "titan" | "nape";
  aimDist: number;
  danger: number;
  hurt: number;
  resupplying: boolean;
  lock: "locked" | "edge" | "none";
  deathCause: string;
}
export interface GameCallbacks {
  onBark?: (b: BarkMsg) => void;
  onToast?: (t: ToastMsg) => void;
  onPhase?: (p: Phase) => void;
  /** A wave was cleared (the progress total counts these across runs). */
  onWaveCleared?: (wave: number) => void;
}

const PRIORITY = new Set<BarkKey>(["grabbed", "ally_grabbed", "rescue_go", "panic", "rescued", "wave_start", "spot_abnormal"]);
const PLAYER_NAME = "Cadet";

class V2 {
  x = 0;
  y = 0;
}

const hasDoc = typeof document !== "undefined";
const _v = new V3();
const _w = new V3();
const _f = new V3();
const _r = new V3();
const _aimO = new V3();

/** Damage a glancing (sub-clean) nape cut does to plated titans. Plated kinds need a 1.35× clean cut to die. */
/** Horses: carry up to two, one more every 25 s at a depot. */
const MAX_HORSES = 2;
const HORSE_RESTOCK_S = 25;
/** Extra Survey Corps scouts that patrol Wall Maria with the squad (the named five are always there). */
const EXTRA_SCOUTS = 50;
const RECRUIT_THINK_EVERY = 12;
const PLATE_DMG: Partial<Record<SpawnKind, number>> = { armored: 10, hammer: 120, founding: 250 };

/** How long a hook press waits for the hook to be ready (cooldown or stun) before it is dropped. */
const HOOK_BUFFER = 0.3;

export class Game implements Sim {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(72, 1, 0.3, 14000);
  renderer: THREE.WebGLRenderer | null = null;
  world: World;
  fx: FX;
  scouts: Scout[] = [];
  titans: Titan[] = [];
  brains: BotBrain[] = [];
  player: Scout;
  time = 0;
  phase: Phase = "menu";
  wave = 0;
  kills = 0;
  napeKills = 0;
  score = 0;
  deathCause = "";

  // input / camera
  private keys = new Set<string>();
  private mouse = [false, false];
  private pendFire = [0, 0];
  /** Touch layer state (written by the on-screen pad in Touch.tsx). mx/my: stick, +my is forward. */
  readonly touch = { mx: 0, my: 0, boost: false, hold: [false, false] as [boolean, boolean], lookX: 0, lookY: 0, active: false };
  private pendSlash = false;
  /** Perk-adjusted player stats for the current run, and the loadout they came from. */
  private stats: BaseStats = BASE_STATS;
  private pendSwap = false;
  private pendSpear = false;
  private music = new Music();
  private spearT = 0;
  private pendStruggle = false;
  private camYaw = 0;
  private camPitch = -0.12;
  private camTarget = new V3();
  private camDist = 9;
  private shake = 0;
  private lockActive = false;
  private edgePan = false;
  private mouseN = new V2();
  private cleanup: (() => void)[] = [];
  private canvas: HTMLCanvasElement | null = null;
  private overlay: HTMLCanvasElement | null = null;
  private octx: CanvasRenderingContext2D | null = null;
  private mini: HTMLCanvasElement | null = null;
  private mctx: CanvasRenderingContext2D | null = null;
  private miniT = 0;

  private playerCtrl: ScoutControl = newControl();
  private timeScale = 1;
  private slowT = 0;
  private waveState: "active" | "clear" = "active";
  private kick: { titan: Titan; t: number; stage: "walk" | "windup" } | null = null;
  private waveTimer = 0;
  private combo = 0;
  private comboT = 0;
  private lastBark = new Map<string, number>();
  private lastAnyBark = -10;
  private barkId = 1;
  private toastId = 1;
  private noticedAbnormal = new Set<number>();
  private scanT = 0;
  private resupT = new Map<string, number>();
  private horseT = 0;
  private resupMsgT = 0;
  private resupplying = false;
  private aim: { hit: RayHit | null; point: V3 } = { hit: null, point: new V3() };
  private aimKind: Snapshot["aim"] = "none";
  private brainOf = new Map<string, BotBrain>();
  private sun!: THREE.DirectionalLight;
  private sky!: THREE.Mesh;
  private skyMat!: THREE.ShaderMaterial;
  private hemi!: THREE.HemisphereLight;
  /** time of day as a fraction of a day (0 = sunrise); see daynight.ts */
  dayT = (START_HOUR - 6) / 24;
  private thinkFrame = 0;
  /** wave title cards and the Tab map (App turns cinematics on; tests leave them off) */
  cinematics = false;
  intro: (IntroCard & { t: number }) | null = null;
  mapOpen = false;
  private w = 1280;
  private h = 720;
  private raf = 0;
  private lastT = 0;
  private delayed: { t: number; fn: () => void }[] = [];
  readonly sfx = new Sfx();
  private prevHook: [string, string] = ["idle", "idle"];
  private prevSlash = 0;

  constructor(
    private cb: GameCallbacks = {},
    opts: { canvas?: HTMLCanvasElement; overlay?: HTMLCanvasElement; minimap?: HTMLCanvasElement } = {}
  ) {
    this.sfx.onReady = (ctx, out) => this.music.attach(ctx, out);
    this.world = new World(1337);
    this.fx = new FX();
    this.scene.add(this.world.group, this.fx.group);
    this.scene.fog = new THREE.FogExp2(0xbfd0dc, 0.00075);
    this.scene.background = new THREE.Color(0xbfd0dc);
    this.setupLights();

    // squad
    this.player = new Scout({
      id: "player",
      name: PLAYER_NAME,
      isPlayer: true,
      palette: { cloak: 0x2f8a4a, hair: 0x4a3322, accent: 0xffffff },
      maxHp: 100,
      killSpeed: 12,
      dmgMult: 1,
    });
    const defs: { kind: BotKind; hp: number; ks: number; dm: number; pal: { cloak: number; hair: number; accent: number; accentOnHead?: boolean } }[] = [
      { kind: "veteran", hp: 90, ks: 11, dm: 1, pal: { cloak: 0x34503a, hair: 0x9a9a9a, accent: 0x6e86b0 } },
      { kind: "hothead", hp: 80, ks: 9, dm: 2, pal: { cloak: 0x3f6b3a, hair: 0xb3321c, accent: 0xd24a1a, accentOnHead: true } },
      { kind: "rookie", hp: 60, ks: 12, dm: 1, pal: { cloak: 0x4d7a45, hair: 0xe0c068, accent: 0xf2d34a } },
      { kind: "lancer", hp: 85, ks: 10, dm: 1.5, pal: { cloak: 0x5a3f7a, hair: 0x2b2030, accent: 0xc58bff } },
      { kind: "sentinel", hp: 75, ks: 11, dm: 1, pal: { cloak: 0x2f5b4f, hair: 0x6b5a3a, accent: 0x7ad1b5 } },
    ];
    const bots = defs.map(
      (d) =>
        new Scout({
          id: d.kind,
          name: PERSONALITIES[d.kind].name,
          isPlayer: false,
          palette: d.pal,
          maxHp: d.hp,
          killSpeed: d.ks,
          dmgMult: d.dm,
          crashResist: 0.3,
        })
    );
    // the Survey Corps roster: more scouts spread across Wall Maria, with the same five temperaments
    const extras: Scout[] = [];
    const extraKinds: BotKind[] = [];
    const extraNames: string[] = [];
    for (let i = 0; i < EXTRA_SCOUTS; i++) {
      const d = defs[i % defs.length];
      extraKinds.push(d.kind);
      extraNames.push(`Recruit ${String(i + 1).padStart(2, "0")}`);
      extras.push(
        new Scout({
          id: `recruit-${i}`,
          name: extraNames[i],
          isPlayer: false,
          palette: d.pal,
          maxHp: d.hp,
          killSpeed: d.ks,
          dmgMult: d.dm,
          crashResist: 0.3,
        })
      );
    }
    const all = [...bots, ...extras];
    this.scouts = [this.player, ...all];
    this.brains = makeBrains(all, [...defs.map((d) => d.kind), ...extraKinds], this.player, [...bots.map((b) => b.name), ...extraNames]);
    this.brains.forEach((b) => this.brainOf.set(b.scout.id, b));
    for (const s of this.scouts) this.scene.add(s.model);

    if (opts.canvas) this.attachRenderer(opts.canvas, opts.overlay, opts.minimap);
    this.resetRun();
  }

  // ------------------------------------------------------------------ setup
  private setupLights() {
    const hemi = new THREE.HemisphereLight(0xdbe8ff, 0x6b5f50, 1.05);
    this.hemi = hemi;
    this.scene.add(hemi);
    this.sun = new THREE.DirectionalLight(0xfff0d6, 2.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -85;
    sc.right = 85;
    sc.top = 85;
    sc.bottom = -85;
    sc.near = 10;
    sc.far = 400;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.5;
    this.scene.add(this.sun, this.sun.target);

    const mat = (this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: { top: { value: new THREE.Color(0x3d78c8) }, horizon: { value: new THREE.Color(0xd2dfeb) } },
      vertexShader: [
        "varying vec3 vP;",
        "void main() {",
        "  vP = normalize(position);",
        "  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);",
        "}",
      ].join("\n"),
      fragmentShader: [
        "uniform vec3 top;",
        "uniform vec3 horizon;",
        "varying vec3 vP;",
        "void main() {",
        "  float h = clamp(vP.y, 0.0, 1.0);",
        "  vec3 c = mix(horizon, top, pow(h, 0.5));",
        "  gl_FragColor = vec4(c, 1.0);",
        "  #include <tonemapping_fragment>",
        "  #include <colorspace_fragment>",
        "}",
      ].join("\n"),
    }));
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(9000, 32, 16), mat);
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);
  }

  private attachRenderer(canvas: HTMLCanvasElement, overlay?: HTMLCanvasElement, mini?: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.overlay = overlay ?? null;
    this.octx = overlay ? overlay.getContext("2d") : null;
    this.mini = mini ?? null;
    this.mctx = mini ? mini.getContext("2d") : null;
    this.bindInput(canvas);
    this.resize(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight);
  }

  setMinimap(el: HTMLCanvasElement | null) {
    this.mini = el;
    this.mctx = el ? el.getContext("2d") : null;
  }

  resize(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    if (this.renderer) this.renderer.setSize(w, h, false);
    if (this.overlay) {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.overlay.width = Math.floor(w * dpr);
      this.overlay.height = Math.floor(h * dpr);
    }
  }

  // ------------------------------------------------------------------ input
  private bindInput(canvas: HTMLCanvasElement) {
    const on = <K extends keyof WindowEventMap>(t: Window, k: K, f: (e: WindowEventMap[K]) => void) => {
      t.addEventListener(k, f as EventListener);
      this.cleanup.push(() => t.removeEventListener(k, f as EventListener));
    };
    on(window, "keydown", (e) => {
      if (this.phase !== "playing") return;
      if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Tab"].includes(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === "KeyR") this.pendSwap = true;
      // AOT Revolution layout: Q / E fire the left / right hook (hold to keep the rope), LMB cuts, F throws a spear
      if (e.code === "KeyQ") this.pendFire[0] = HOOK_BUFFER;
      if (e.code === "KeyE") this.pendFire[1] = HOOK_BUFFER;
      if (e.code === "KeyF") this.pendSpear = true;
      if (e.code === "Space") this.pendStruggle = true;
      if (e.code === "KeyP") this.pause();
      if (e.code === "Tab") this.toggleMap();
      if (e.code === "KeyH") this.toggleMount();
      if (e.code === "KeyM") this.sfx.toggleMute();
    });
    on(window, "keyup", (e) => {
      this.keys.delete(e.code);
    });
    on(window, "blur", () => {
      this.keys.clear();
      this.mouse[0] = this.mouse[1] = false;
    });
    on(window, "mousedown", (e) => {
      if (this.phase !== "playing") return;
      // touch screens fire emulated mouse events after a tap: those are handled by the touch pad
      if ((e as any).sourceCapabilities?.firesTouchEvents || this.touch.active) return;
      if (e.target !== canvas && e.target !== this.overlay) return;
      if (e.button === 0) {
        // a click is a user gesture: if the mouse is not captured (e.g. after Esc), try to capture it again
        if (!this.lockActive && !this.touch.active) this.requestLock();
        this.mouse[0] = true;
        this.pendSlash = true;
      } else if (e.button === 1) {
        e.preventDefault();
      }
    });
    on(window, "mouseup", (e) => {
      if (e.button === 0) this.mouse[0] = false;
      if (e.button === 2) this.mouse[1] = false;
    });
    on(window, "contextmenu", (e) => {
      if (this.phase === "playing") e.preventDefault();
    });
    on(window, "mousemove", (e) => {
      if (this.phase !== "playing") return;
      if (this.lockActive) {
        this.camYaw -= e.movementX * 0.0022;
        this.camPitch = clamp(this.camPitch - e.movementY * 0.0022, -1.3, 1.3);
      }
      this.mouseN.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.mouseN.y = (e.clientY / window.innerHeight) * 2 - 1;
    });
    const onLock = () => {
      const locked = document.pointerLockElement === canvas;
      if (locked) {
        this.lockActive = true;
        this.edgePan = false;
        if (this.phase === "paused") this.resume(false);
      } else if (this.lockActive) {
        this.lockActive = false;
        if (this.phase === "playing") this.pause();
      }
    };
    document.addEventListener("pointerlockchange", onLock);
    document.addEventListener("pointerlockerror", () => {
      this.edgePan = true;
    });
    this.cleanup.push(() => document.removeEventListener("pointerlockchange", onLock));
  }

  /** Must be called from a user gesture (click). */
  requestLock() {
    const c = this.canvas;
    if (!c) return;
    try {
      const p = (c.requestPointerLock as unknown as () => Promise<void> | void)?.call(c);
      if (p && typeof (p as Promise<void>).catch === "function") (p as Promise<void>).catch(() => (this.edgePan = true));
    } catch {
      this.edgePan = true;
    }
    window.setTimeout(() => {
      if (this.lockActive || this.phase !== "playing") return;
      this.edgePan = true;
      this.toast("Mouse not captured — click the screen again to lock it", "info");
    }, 700);
  }

  // ------------------------------------------------------------------ lifecycle
  /** Start a fresh run. `fromWave` lets a player retry the level they died on or resume a saved run. */
  start(fromWave = 1) {
    this.sfx.init();
    this.resetRun();
    this.setPhase("playing");
    this.startWave(Math.max(1, Math.min(FINAL_WAVE, Math.floor(fromWave) || 1)));
  }
  restart() {
    this.start();
  }
  pause() {
    if (this.phase !== "playing") return;
    this.setPhase("paused");
    this.keys.clear();
    this.mouse[0] = this.mouse[1] = false;
    if (hasDoc && document.pointerLockElement) document.exitPointerLock?.();
  }
  resume(lock = true) {
    if (this.phase !== "paused") return;
    this.setPhase("playing");
    this.sfx.init();
    if (lock) this.requestLock();
  }
  private setPhase(p: Phase) {
    this.phase = p;
    if (this.canvas) this.canvas.style.cursor = p === "playing" ? "none" : "default";
    this.music.duck(p !== "playing");
    if (p === "dead") this.music.stop();
    else if (p === "won") this.music.playEnding();
    this.cb.onPhase?.(p);
  }

  private resetRun() {
    this.music.stop();
    for (const t of this.titans) this.scene.remove(t.model);
    this.titans = [];
    this.wave = 0;
    this.kills = 0;
    this.napeKills = 0;
    this.score = 0;
    this.combo = 0;
    this.time = 0;
    this.waveState = "active";
    this.kick = null;
    this.delayed = [];
    this.noticedAbnormal.clear();
    this.lastBark.clear();
    const sp = this.world.playerSpawn;
    this.applyStats();
    this.player.reset(_v.set(sp.x, 1, sp.z));
    this.player.setMounted(false);
    this.player.horses = 1; // one horse waits in the supply at the start of a run
    this.horseT = 0;
    this.player.kills = 0;
    this.player.spears = 2;
    this.spearT = 0;
    this.camYaw = 0;
    this.camPitch = -0.12;
    this.brains.forEach((b, i) => {
      if (i < 5) {
        b.scout.reset(_v.set(sp.x + [-5, 5, 0, -9, 9][i], 1, sp.z + [2, 2, -5, -1, -1][i]));
      } else {
        // recruits are spread over Wall Maria, away from the titans' spawn band
        const p = this.freeSpot(ROSE_R + 60, MARIA_R - 80, (x, z) => Math.hypot(x - sp.x, z - sp.z) > 60);
        b.scout.reset(p ? _v.set(p.x, 1, p.z) : _v.set(sp.x + 6 + i, 1, sp.z + 6));
      }
      b.scout.kills = 0;
      b.respawn();
    });
    this.camTarget.copy(this.player.pos);
  }

  /** Perk loadout for the next run (the menu sets it before deploying). */
  setLoadout(ids: string[], totalWaves: number) {
    this.stats = applyLoadout(BASE_STATS, ids, totalWaves);
  }

  private applyStats() {
    const p = this.player;
    const s = this.stats;
    p.maxHp = s.maxHp;
    p.maxGas = s.maxGas;
    p.maxSpare = s.maxSpare;
    p.killSpeed = s.killSpeed;
    p.maxSpears = s.maxSpears;
    p.cooldownMult = s.hookCooldown;
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.cleanup.forEach((f) => f());
    this.cleanup = [];
    if (hasDoc && document.pointerLockElement) document.exitPointerLock?.();
    this.sfx.setGas(false);
    this.renderer?.dispose();
  }

  /** Browser main loop. */
  run() {
    const loop = (t: number) => {
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (t - this.lastT) / 1000 || 0.016);
      this.lastT = t;
      this.update(dt);
      this.render();
    };
    this.raf = requestAnimationFrame(loop);
  }

  // ------------------------------------------------------------------ waves
  private startWave(n: number) {
    this.music.play(n);
    this.wave = n;
    this.waveState = "active";
    this.reinforce();
    const spec = waveSpec(n);
    if (this.cinematics) this.intro = { ...introFor(spec), t: INTRO_SECONDS };
    const spawned: V3[] = [];
    const inMaria = (x: number, z: number) => {
      const d = Math.hypot(x, z);
      return d > ROSE_R + 40 && d < MARIA_R - 60;
    };
    const outsideSpawns: SpawnSpec[] = spec.spawns.filter((s) => s.outside);
    for (const sp of spec.spawns) {
      if (sp.outside) continue;
      const p = this.freeSpot(ROSE_R + 40, MARIA_R - 60, (x, z) => {
        if (!inMaria(x, z)) return false;
        if (Math.hypot(x - this.player.pos.x, z - this.player.pos.z) < 55) return false;
        return spawned.every((q) => Math.hypot(x - q.x, z - q.z) > 25);
      });
      if (!p) continue;
      spawned.push(p);
      this.addTitan(sp, p);
    }
    for (const sp of outsideSpawns) this.spawnOutside(sp);
    if (spec.colossalKick) {
      const c = this.titans.find((t) => t.kind === "colossal" && t.alive);
      if (c) {
        c.scripted = { to: new V3(0, 0, MARIA_R), arriveR: 14, arrived: false };
        this.kick = { titan: c, t: 0, stage: "walk" };
        this.after(1.5, () => this.toast("A colossal titan is walking toward Shiganshina!", "bad"));
      }
    }
    // squad mates who are still alive get a little gas; the dead stay dead (one life each).
    for (const b of this.brains) {
      if (b.scout.alive) b.scout.gas = Math.min(b.scout.maxGas, b.scout.gas + 20);
    }
    // the player gets a modest top-up between waves (supplies are scarce on purpose)
    if (n > 1) {
      const pl = this.player;
      pl.gas = Math.min(pl.maxGas, pl.gas + 25);
      if (pl.spare < pl.maxSpare) pl.spare = Math.min(pl.maxSpare, pl.spare + 1);
    }
    this.toast(`WAVE ${n} — ${spec.title.toUpperCase()}`, "info");
    if (n === 1) {
      this.after(2.2, () => this.toast("Aim at a rooftop, click LMB / RMB to grapple, hold SPACE to boost", "info"));
      this.after(6, () => this.toast("Hit the glowing red nape at 12+ m/s and press F to cut", "info"));
    }
    const talkers = this.brains.filter((b) => b.scout.alive).sort(() => Math.random() - 0.5).slice(0, 2);
    talkers.forEach((b, i) => this.after(0.9 + i * 1.7, () => b.scout.alive && this.bark(b.scout, "wave_start", { wave: n })));
    const vet = this.brains[0].scout;
    if (vet.alive && this.titans.length) {
      const near = this.titans.reduce((a, t) => (this.dist2(t.pos, this.player.pos) < this.dist2(a.pos, this.player.pos) ? t : a));
      this.after(4.2, () => this.bark(vet, "spot_titan", { dir: relativeDir(this.player.pos, this.player.yaw, near.pos), height: Math.round(near.height) }));
    }
  }

  /**
   * A free ground point in the annulus [r0, r1] around (cx, cz) that passes `accept`.
   * (NavGrid.randomFree samples the whole map, which is far too sparse for thin bands like Maria.)
   */
  private freeSpot(r0: number, r1: number, accept: (x: number, z: number) => boolean, cx = 0, cz = 0): V3 | null {
    const nav = this.world.nav;
    for (let k = 0; k < 800; k++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(r0 * r0 + Math.random() * (r1 * r1 - r0 * r0));
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      if (nav.blocked(nav.cx(x), nav.cx(z), 0.5, 1)) continue;
      if (!accept(x, z)) continue;
      return new V3(x, 0, z);
    }
    return null;
  }

  private addTitan(sp: SpawnSpec, p: V3) {
    const t = new Titan(sp.height, sp.kind === "abnormal", p, sp.kind);
    this.titans.push(t);
    this.scene.add(t.model);
    return t;
  }

  /** Spawn outside Wall Maria, near OUTSIDE_HOME (or a given point), on free ground. */
  private spawnOutside(sp: SpawnSpec, near: { x: number; z: number } = OUTSIDE_HOME) {
    const p = this.freeSpot(0, 110, (x, z) => wallRingAt(x, z) === "outside", near.x, near.z);
    if (p) this.addTitan(sp, p);
  }

  /** Wave-10 event: the colossal kicks Wall Maria at Shiganshina and the titans come through the gap. */
  private updateKick(dt: number) {
    const k = this.kick;
    if (!k) return;
    if (!k.titan.alive) {
      this.kick = null; // killed before it could breach the wall
      return;
    }
    if (k.stage === "walk" && k.titan.scripted?.arrived) {
      k.stage = "windup";
      k.t = 0;
      this.toast("The colossal titan is at Wall Maria!", "bad");
      this.shake = 1;
    } else if (k.stage === "windup") {
      k.t += dt;
      if (k.t >= KICK_WINDUP) {
        this.breachMaria(k.titan);
        this.kick = null;
      }
    }
  }

  private breachMaria(colossal: Titan) {
    const gap = 40; // metres either side of the gate
    this.world.breachRing("maria", Math.PI / 2, gap);
    colossal.scripted = null;
    colossal.state = "wander";
    this.shake = 1.5;
    this.fx.dust(new V3(0, 0, MARIA_R), 40);
    this.sfx.kill();
    this.toast("WALL MARIA IS BREACHED — titans are pouring through the gate!", "bad");
    const breach = waveSpec(this.wave).breachReinforce;
    breach.forEach((sp, i) => this.after(0.6 + i * 0.7, () => this.spawnOutside(sp, { x: 0, z: MARIA_R + 150 })));
  }

  /** Depots: resupply and healing, both switched off while a titan is too close. */
  private healing(dt: number) {
    for (const s of this.scouts) {
      if (!s.alive || s.hp <= HEAL_FLOOR || s.hp >= s.maxHp) continue;
      s.hp = Math.min(s.maxHp, s.hp + 0.35 * dt);
    }
  }

  private after(sec: number, fn: () => void) {
    this.delayed.push({ t: this.time + sec, fn });
  }

  private dist2(a: V3, b: V3) {
    return (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
  }

  // ------------------------------------------------------------------ Sim interface
  rayWorld(o: V3, d: V3, maxDist: number, includeTitans: boolean): RayHit | null {
    let best = this.world.raycast(o, d, maxDist);
    if (includeTitans) {
      for (const t of this.titans) {
        if (!t.alive) continue;
        for (const sph of t.spheres) {
          const ocx = o.x - sph.c.x;
          const ocy = o.y - sph.c.y;
          const ocz = o.z - sph.c.z;
          const b = ocx * d.x + ocy * d.y + ocz * d.z;
          const cc = ocx * ocx + ocy * ocy + ocz * ocz - sph.r * sph.r;
          const disc = b * b - cc;
          if (disc < 0) continue;
          const tt = -b - Math.sqrt(disc);
          if (tt < 0 || tt > (best ? best.dist : maxDist)) continue;
          const p = new V3(o.x + d.x * tt, o.y + d.y * tt, o.z + d.z * tt);
          best = { dist: tt, point: p, normal: p.clone().sub(sph.c).normalize(), kind: "titan", titan: t };
        }
      }
    }
    return best;
  }

  noise(pos: V3, radius: number, src: Scout | null) {
    for (const t of this.titans) if (t.alive) t.hear(pos, radius, src);
  }

  bark(scout: Scout, key: BarkKey, vars: Record<string, string | number> = {}) {
    const brain = this.brainOf.get(scout.id);
    if (!brain) return;
    const prio = PRIORITY.has(key);
    const last = this.lastBark.get(scout.id) ?? -99;
    if (!prio && this.time - last < 4) return;
    if (this.time - this.lastAnyBark < (prio ? 0.5 : 1.6)) return;
    const text = formatBark(brain.P.kind, key, vars);
    if (!text) return;
    this.lastBark.set(scout.id, this.time);
    this.lastAnyBark = this.time;
    this.cb.onBark?.({ id: this.barkId++, who: brain.P.name, title: brain.P.title, color: brain.P.color, text, key });
  }

  toast(text: string, kind: ToastMsg["kind"] = "info") {
    this.cb.onToast?.({ id: this.toastId++, text, kind });
  }

  onGrab(scout: Scout, titan: Titan) {
    void titan;
    if (scout.isPlayer) {
      this.sfx.grab();
      this.toast("GRABBED! Mash SPACE to break free — or get a squadmate to cut it down!", "bad");
      this.shake = 1;
    } else this.toast(`${scout.name} has been grabbed!`, "bad");
    for (const b of this.brains) {
      if (b.scout !== scout && b.scout.alive) this.bark(b.scout, "ally_grabbed", { name: scout.name });
    }
  }
  onSwat(scout: Scout, titan: Titan) {
    void titan;
    if (scout.isPlayer) {
      this.shake = 1;
      this.sfx.hurt();
      this.toast("Swatted!", "bad");
    }
  }
  onEaten(scout: Scout, titan: Titan) {
    void titan;
    this.toast(`${scout.name} was eaten...`, "bad");
  }
  onCrash(scout: Scout, impact: number, damage: number) {
    if (scout.isPlayer) {
      this.sfx.hurt();
      this.shake = Math.max(this.shake, clamp(impact / 30, 0.3, 1));
      if (damage > 8) this.toast("Crash landing!", "bad");
    } else if (damage > 3) this.bark(scout, "crash");
  }
  onScoutDied(scout: Scout, cause: string) {
    if (scout.isPlayer) {
      this.deathCause = cause === "eaten" ? "Devoured by a Titan" : cause === "swat" ? "Struck down by a Titan" : cause === "squeeze" ? "Crushed in a Titan's grip" : "Crashed into the town";
      this.setPhase("dead");
      if (hasDoc && document.pointerLockElement) document.exitPointerLock?.();
    } else {
      this.toast(`${scout.name} is KIA (${cause})`, "bad");
    }
  }
  onTitanKilled(titan: Titan, by: Scout | null) {
    this.kills++;
    if (by) {
      by.kills++;
      if (by.isPlayer) {
        this.napeKills++;
        this.comboT = 7;
        this.combo++;
        const pts = Math.round(100 + titan.height * 10 + (this.combo - 1) * 25 + (titan.abnormal ? 100 : 0));
        this.score += pts;
        this.toast(`NAPE SLICE  +${pts}${this.combo > 1 ? `  x${this.combo} COMBO` : ""}`, "kill");
        const living = this.brains.filter((b) => b.scout.alive);
        if (living.length && Math.random() < 0.6) this.bark(pick(living).scout, "praise");
      } else {
        this.score += 30;
        this.toast(`${by.name} cut down a ${Math.round(titan.height)}m Titan`, "good");
        this.bark(by, "kill");
      }
    }
    this.slowT = 0.45;
    this.shake = Math.max(this.shake, 0.5);
    this.sfx.kill();
  }

  // ------------------------------------------------------------------ combat
  private resolveSlash(s: Scout) {
    for (const t of this.titans) {
      if (!t.alive) continue;
      const dn = s.pos.distanceTo(t.nape);
      if (dn > 3.0 + t.napeR) continue;
      const fx = Math.sin(t.yaw);
      const fz = Math.cos(t.yaw);
      const front = (s.pos.x - t.nape.x) * fx + (s.pos.z - t.nape.z) * fz;
      if (front > t.napeR * 1.2 + 1.5) continue; // face side: nape not reachable
      s.slashHit = true;
      const rel = _v.copy(s.vel).sub(t.vel).length();
      // armored titans and the war-hammer / Founding bosses wear plate over the nape:
      // only a hard, clean cut gets through; a glancing cut chips the plate for PLATE_DMG
      const plate = PLATE_DMG[t.kind];
      if (plate && rel < s.killSpeed * 1.35) {
        s.bladeDur = Math.max(0, s.bladeDur - 12);
        t.hp = Math.max(1, t.hp - plate * s.dmgMult);
        this.fx.sparks(t.nape, 10, [0.85, 0.85, 0.9]);
        if (s.isPlayer) this.toast(`Armour plate! Need ${Math.ceil(s.killSpeed * 1.35)}+ m/s to cut through`, "bad");
        return;
      }
      if (rel >= s.killSpeed) {
        const freed = t.grabbed;
        s.bladeDur = Math.max(0, s.bladeDur - rand(9, 15));
        this.fx.sparks(t.nape, 14, [1, 0.3, 0.2]);
        t.kill(s, this);
        if (freed) this.onRescue(freed, s);
      } else {
        t.hp = Math.max(1, t.hp - 30 * s.dmgMult);
        s.bladeDur = Math.max(0, s.bladeDur - 8);
        this.fx.sparks(t.nape, 8);
        if (s.isPlayer) this.toast(`Too slow! Need ${s.killSpeed}+ m/s for a clean cut`, "bad");
      }
      return;
    }
    for (const t of this.titans) {
      if (!t.alive) continue;
      for (const sph of t.spheres) {
        if (sph.kind === "nape") continue;
        if (s.pos.distanceTo(sph.c) > sph.r + 2.7) continue;
        s.slashHit = true;
        t.hp = Math.max(1, t.hp - 2 * s.dmgMult);
        s.bladeDur = Math.max(0, s.bladeDur - rand(18, 26));
        _w.copy(s.pos).lerp(sph.c, 0.5);
        this.fx.sparks(_w, 10);
        if (s.isPlayer) this.sfx.clang();
        if (s.isPlayer) this.toast(s.bladeDur <= 0 ? "Blades shattered on flesh! Press R" : "Not the nape — blades dulled!", "bad");
        return;
      }
    }
  }

  /** Fallen teammates rejoin at the start of the next wave: one life per engagement. */
  private reinforce() {
    const sp = this.player.pos;
    const offX = [-5, 5, 0, -9, 9, -7, 7];
    const offZ = [2, 2, -5, -1, -1, -6, -6];
    this.brains.forEach((b, i) => {
      if (b.scout.alive) return;
      const at = _v.set(sp.x + offX[i % offX.length], 1, sp.z + offZ[i % offZ.length]);
      b.scout.reset(at);
      b.scout.kills = 0;
      b.respawn();
      this.bark(b.scout, "reinforce");
    });
  }

  private onRescue(freed: Scout, by: Scout) {
    if (by.isPlayer) {
      this.score += 150;
      this.toast(`RESCUED ${freed.name}  +150`, "good");
    }
    if (!freed.isPlayer) this.bark(freed, "rescued");
    else {
      this.toast(`${by.name} saved you!`, "good");
      const b = this.brains.find((x) => x.scout.alive && x.scout !== by);
      if (b) this.bark(b.scout, "thanks");
    }
  }

  // ------------------------------------------------------------------ per-frame update
  private buildPlayerCtrl(dt: number) {
    const c = this.playerCtrl;
    clearControl(c);
    const k = this.keys;
    // keyboard look
    if (k.has("ArrowLeft")) this.camYaw += 2.2 * dt;
    if (k.has("ArrowRight")) this.camYaw -= 2.2 * dt;
    if (k.has("ArrowUp")) this.camPitch = clamp(this.camPitch + 1.6 * dt, -1.3, 1.3);
    if (k.has("ArrowDown")) this.camPitch = clamp(this.camPitch - 1.6 * dt, -1.3, 1.3);
    const tc = this.touch;
    if (tc.lookX || tc.lookY) {
      this.camYaw -= tc.lookX * 0.0028;
      this.camPitch = clamp(this.camPitch - tc.lookY * 0.0028, -1.3, 1.3);
      tc.lookX = tc.lookY = 0;
    }
    if (this.edgePan && !this.lockActive) {
      const dz = 0.28;
      const mx = this.mouseN.x;
      const my = this.mouseN.y;
      if (Math.abs(mx) > dz) this.camYaw -= Math.sign(mx) * ((Math.abs(mx) - dz) / (1 - dz)) * 2.4 * dt;
      if (Math.abs(my) > dz) this.camPitch = clamp(this.camPitch - Math.sign(my) * ((Math.abs(my) - dz) / (1 - dz)) * 1.6 * dt, -1.3, 1.3);
    }
    _f.set(Math.sin(this.camYaw), 0, Math.cos(this.camYaw));
    _r.set(-Math.cos(this.camYaw), 0, Math.sin(this.camYaw));
    const fw = clamp((k.has("KeyW") ? 1 : 0) - (k.has("KeyS") ? 1 : 0) + tc.my, -1, 1);
    const rt = clamp((k.has("KeyD") ? 1 : 0) - (k.has("KeyA") ? 1 : 0) + tc.mx, -1, 1);
    c.move.set(0, 0, 0).addScaledVector(_f, fw).addScaledVector(_r, rt);
    if (c.move.lengthSq() > 1) c.move.normalize();
    c.boost = k.has("Space") || tc.boost;
    c.reel = k.has("ShiftLeft") || k.has("ShiftRight");
    const cp = Math.cos(this.camPitch);
    c.boostDir.set(Math.sin(this.camYaw) * cp, Math.sin(this.camPitch), Math.cos(this.camYaw) * cp);
    c.hold[0] = this.keys.has("KeyQ") || tc.hold[0];
    c.hold[1] = this.keys.has("KeyE") || tc.hold[1];
    for (let i = 0; i < 2; i++) {
      if (this.pendFire[i] > 0) {
        this.pendFire[i] -= dt;
        const h = this.player.hooks[i];
        if (h.state === "idle" && h.cooldown <= 0 && this.player.stun <= 0 && this.player.alive) {
          this.player.handPos(i, _w);
          const dir = _v.subVectors(this.aim.point, _w).normalize().clone();
          c.fire[i] = dir;
          this.pendFire[i] = 0;
        }
      }
    }
    c.slash = this.pendSlash;
    c.swap = this.pendSwap;
    c.struggle = this.pendStruggle && !!this.player.grabbedBy;
    this.pendSlash = this.pendSwap = this.pendStruggle = false;
  }

  /** One-shot touch actions, queued like the matching keys. */
  touchAction(a: "hookL" | "hookR" | "slash" | "spear" | "reload" | "struggle") {
    if (this.phase !== "playing") return;
    if (a === "hookL") this.pendFire[0] = HOOK_BUFFER;
    else if (a === "hookR") this.pendFire[1] = HOOK_BUFFER;
    else if (a === "slash") this.pendSlash = true;
    else if (a === "spear") this.pendSpear = true;
    else if (a === "reload") this.pendSwap = true;
    else if (a === "struggle") this.pendStruggle = true;
  }

  private updateAim() {
    const cp = Math.cos(this.camPitch);
    _f.set(Math.sin(this.camYaw) * cp, Math.sin(this.camPitch), Math.cos(this.camYaw) * cp);
    const along = Math.max(0, _v.subVectors(this.player.pos, this.camera.position).dot(_f));
    _aimO.copy(this.camera.position).addScaledVector(_f, along);
    const hit = this.rayWorld(_aimO, _f, HOOK_RANGE + 15, true);
    this.aim.hit = hit;
    if (hit) this.aim.point.copy(hit.point);
    else this.aim.point.copy(_aimO).addScaledVector(_f, 80);
    if (!hit) this.aimKind = "none";
    else if (hit.kind === "titan" && hit.titan) this.aimKind = hit.point.distanceTo(hit.titan.nape) < hit.titan.napeR ? "nape" : "titan";
    else this.aimKind = hit.dist <= HOOK_RANGE ? "hook" : "none";
  }

  update(dtReal: number) {
    if (this.phase !== "playing") {
      return;
    }
    // the wave title card and the Tab map hold the simulation still
    if (this.intro) {
      this.intro.t -= dtReal;
      if (this.intro.t <= 0) this.intro = null;
      return;
    }
    if (this.mapOpen) return;
    this.slowT = Math.max(0, this.slowT - dtReal);
    this.world.nav.beginFrame();
    this.timeScale = damp(this.timeScale, this.slowT > 0 ? 0.3 : 1, 12, dtReal);
    const dt = Math.min(dtReal, 1 / 20) * this.timeScale;
    this.time += dt;
    this.dayT = (this.dayT + dt / DAY_SEC) % 1;
    this.comboT -= dt;
    if (this.comboT <= 0) this.combo = 0;

    for (let i = this.delayed.length - 1; i >= 0; i--) {
      if (this.time >= this.delayed[i].t) this.delayed.splice(i, 1)[0].fn();
    }
    this.world.setFocus(this.player.pos.x, this.player.pos.z);
    this.updateAim();
    this.buildPlayerCtrl(dtReal);

    // the named five think every frame; recruits think every 12th frame (with 12x dt, so their timers keep time)
    // and hold their last control in between. This keeps 55 scouts within the frame budget.
    this.thinkFrame++;
    for (let i = 0; i < this.brains.length; i++) {
      const b = this.brains[i];
      let ctrl = b.ctrl;
      if (i < 5) ctrl = b.think(dt, this);
      else if ((this.thinkFrame + i) % RECRUIT_THINK_EVERY === 0) ctrl = b.think(dt * RECRUIT_THINK_EVERY, this);
      b.scout.update(dt, ctrl, this);
    }
    this.player.update(dt, this.playerCtrl, this);

    for (const t of this.titans) t.update(dt, this);
    for (let i = this.titans.length - 1; i >= 0; i--) {
      if (this.titans[i].removable) {
        this.scene.remove(this.titans[i].model);
        this.titans.splice(i, 1);
      }
    }

    // scouts vs titan bodies (soft collision) + slashes
    for (const s of this.scouts) {
      if (!s.alive || s.grabbedBy) continue;
      for (const t of this.titans) {
        if (!t.alive) continue;
        for (const sph of t.spheres) {
          if (sph.kind === "nape") continue;
          _v.subVectors(s.pos, sph.c);
          const d = _v.length();
          const min = sph.r + SCOUT_R * 0.8;
          if (d < min && d > 0.001) {
            _v.divideScalar(d);
            s.pos.addScaledVector(_v, min - d);
            const vn = s.vel.dot(_v);
            if (vn < 0) s.vel.addScaledVector(_v, -vn * 1.0);
          }
        }
      }
      if (s.slashing) this.resolveSlash(s);
    }

    this.throwSpear();
    this.depots(dt);
    for (const s of this.scouts) s.syncModel(dt, this);
    this.audioFrame();

    // waves
    const alive = this.titans.filter((t) => t.alive).length;
    {
      // the score swells as the nearest Titan closes in
      let near = Infinity;
      for (const t of this.titans) if (t.alive) near = Math.min(near, Math.hypot(t.pos.x - this.player.pos.x, t.pos.z - this.player.pos.z));
      this.music.setIntensity(1 - (near - 30) / 120);
    }
    this.updateKick(dt);
    this.healing(dt);
    if (this.waveState === "active" && alive === 0 && this.wave > 0 && this.kick === null) {
      if (this.wave >= FINAL_WAVE) {
        this.score += 5000;
        this.toast("WAVE 60 CLEARED — humanity's last stand holds. Victory!", "good");
        this.setPhase("won");
        if (hasDoc && document.pointerLockElement) document.exitPointerLock?.();
        return;
      }
      this.waveState = "clear";
      this.waveTimer = 8;
      this.toast(`WAVE ${this.wave} CLEARED — resupply at the depots!`, "good");
      this.cb.onWaveCleared?.(this.wave);
      this.score += 200 * this.wave;
      const b = pick(this.brains);
      if (b.scout.alive) this.bark(b.scout, "wave_clear");
    } else if (this.waveState === "clear") {
      this.waveTimer -= dt;
      if (this.waveTimer <= 0) this.startWave(this.wave + 1);
    }

    // abnormal sighted callouts
    this.scanT -= dt;
    if (this.scanT <= 0) {
      this.scanT = 0.6;
      for (const t of this.titans) {
        if (t.abnormal && t.alive && !this.noticedAbnormal.has(t.id) && Math.hypot(t.pos.x - this.player.pos.x, t.pos.z - this.player.pos.z) < 85) {
          this.noticedAbnormal.add(t.id);
          const b = pick(this.brains);
          if (b.scout.alive) this.bark(b.scout, "spot_abnormal");
          this.toast("ABNORMAL sighted — it sprints and leaps!", "bad");
          break;
        }
      }
    }

    this.fx.update(dt);
  }

  private audioFrame() {
    const p = this.player;
    this.sfx.setGas(p.boosting);
    for (let i = 0; i < 2; i++) {
      const st = p.hooks[i].state;
      if (this.prevHook[i] === "idle" && st === "flying") this.sfx.hook();
      if (this.prevHook[i] === "flying" && st === "attached") this.sfx.hookHit();
      this.prevHook[i] = st;
    }
    if (this.prevSlash <= 0 && p.slashT > 0) this.sfx.slash();
    this.prevSlash = p.slashT;
    for (const t of this.titans) {
      if (!t.stepped) continue;
      t.stepped = false;
      if (!t.alive) continue;
      const d = Math.hypot(t.pos.x - p.pos.x, t.pos.z - p.pos.z);
      this.sfx.step(t.kind, t.height, clamp(1 - d / 110, 0, 1) * 0.6 * Math.min(1, t.height / 15));
    }
  }

  /** Thunder spear: a hitscan along the camera aim. A hit on a titan pins it for five seconds and costs it a little HP. */
  private throwSpear() {
    if (!this.pendSpear) return;
    this.pendSpear = false;
    const p = this.player;
    if (!p.alive || p.grabbedBy) return;
    if (p.spears <= 0) {
      this.toast("No thunder spears — restock at a depot", "bad");
      return;
    }
    p.spears--;
    this.sfx.spear();
    const cp = Math.cos(this.camPitch);
    const dir = new V3(Math.sin(this.camYaw) * cp, Math.sin(this.camPitch), Math.cos(this.camYaw) * cp).normalize();
    const origin = new V3(p.pos.x, p.pos.y + 0.9, p.pos.z);
    const hit = this.rayWorld(origin, dir, 320, true);
    this.noise(p.pos, 30, p);
    this.shake = Math.max(this.shake, 0.4);
    if (hit && hit.kind === "titan" && hit.titan && hit.titan.alive) {
      const t = hit.titan;
      t.hp = Math.max(1, t.hp - 45);
      t.pin(5);
      this.sfx.spearPin();
      this.fx.sparks(hit.point, 20, [0.6, 0.85, 1]);
      this.toast(t.grabbed ? "The spear hit — but the Titan is holding a squadmate!" : "THUNDER SPEAR — Titan pinned!", "good");
    } else if (hit) {
      this.fx.sparks(hit.point, 6, [0.6, 0.85, 1]);
      this.toast("Spear missed — it hit the city", "info");
    } else this.toast("Spear missed", "info");
  }

  private depots(dt: number) {
    this.resupplying = false;
    for (const s of this.scouts) {
      if (!s.alive || s.grabbedBy) continue;
      for (const d of this.world.depots) {
        if (Math.hypot(d.pos.x - s.pos.x, d.pos.z - s.pos.z) > d.radius || s.pos.y > 4.5) continue;
        const locked = this.titans.some((t) => t.alive && Math.hypot(t.pos.x - d.pos.x, t.pos.z - d.pos.z) < DEPOT_LOCK_R);
        if (locked) {
          if (s.isPlayer && this.resupMsgT <= 0) {
            this.resupMsgT = 4;
            this.toast("Depot offline — a titan is too close!", "bad");
          }
          break;
        }
        s.gas = Math.min(s.maxGas, s.gas + 12 * dt);
        // depots heal at any HP (the passive regen above HEAL_FLOOR is separate)
        s.hp = Math.min(s.maxHp, s.hp + 3 * dt);
        const t = (this.resupT.get(s.id) ?? 0) + dt;
        if (t > 3 && s.spare < s.maxSpare) {
          s.spare++;
          this.resupT.set(s.id, 0);
        } else this.resupT.set(s.id, t);
        if (s.isPlayer && !s.mounted) {
          this.horseT += dt;
          if (this.horseT >= HORSE_RESTOCK_S && s.horses < MAX_HORSES) {
            s.horses++;
            this.horseT = 0;
            this.toast(`Horse restocked (${s.horses}/${MAX_HORSES})`, "good");
          }
        }
        if (s.isPlayer) {
          this.resupplying = true;
          this.spearT += dt;
          if (this.spearT >= this.stats.spearRestock && s.spears < s.maxSpears) {
            s.spears++;
            this.spearT = 0;
            this.toast(`Thunder spear restocked (${s.spears}/${s.maxSpears})`, "good");
          }
        }
        break;
      }
    }
    if (this.resupplying) {
      this.resupMsgT -= dt;
      if (this.resupMsgT <= 0) this.resupMsgT = 4;
    }
  }

  // ------------------------------------------------------------------ rendering
  private updateCamera(dt: number) {
    const p = this.player;
    const cp = Math.cos(this.camPitch);
    _f.set(Math.sin(this.camYaw) * cp, Math.sin(this.camPitch), Math.cos(this.camYaw) * cp);
    _r.set(-Math.cos(this.camYaw), 0, Math.sin(this.camYaw));
    _v.set(p.pos.x, p.pos.y + 0.9 + (p.mounted ? 0.95 : 0), p.pos.z);
    this.camTarget.lerp(_v, 1 - Math.exp(-22 * dt));
    const wantDist = 8 + clamp(p.speed * 0.07, 0, 6);
    this.camDist = damp(this.camDist, wantDist, 4, dt);
    _w.copy(this.camTarget).addScaledVector(_f, -this.camDist).addScaledVector(_r, 1.1);
    _w.y = Math.max(_w.y, 0.8);
    // keep camera out of buildings
    _v.subVectors(_w, this.camTarget);
    const len = _v.length();
    if (len > 0.01) {
      _v.divideScalar(len);
      const hit = this.world.raycast(this.camTarget, _v, len + 0.5);
      if (hit && hit.dist < len + 0.5) _w.copy(this.camTarget).addScaledVector(_v, Math.max(1.2, hit.dist - 0.6));
    }
    this.shake = Math.max(0, this.shake - dt * 2.2);
    if (this.shake > 0) {
      _w.x += (Math.random() - 0.5) * this.shake * 0.7;
      _w.y += (Math.random() - 0.5) * this.shake * 0.7;
    }
    this.camera.position.copy(_w);
    this.camera.lookAt(_w.x + _f.x * 30, _w.y + _f.y * 30, _w.z + _f.z * 30);
    const wantFov = 70 + clamp(p.speed - 12, 0, 40) * 0.38;
    this.camera.fov = damp(this.camera.fov, wantFov, 4, dt);
    this.camera.updateProjectionMatrix();
  }

  /** A slow sweep around the player during the wave title card. */
  private introCamera() {
    const a = performance.now() * 0.00012;
    const c = this.player.pos;
    this.camera.position.set(c.x + Math.cos(a) * 58, c.y + 26 + Math.sin(a * 2) * 4, c.z + Math.sin(a) * 58);
    this.camera.lookAt(c.x, c.y + 4, c.z);
  }

  setCinematics(on: boolean) {
    this.cinematics = on;
  }

  skipIntro() {
    this.intro = null;
  }

  /**
   * H: take a horse from the supply and ride it, or dismount (the horse is left behind, so the supply
   * matters). Riding needs solid ground under you and a free grip, and it blocks the hooks.
   */
  toggleMount() {
    if (this.phase !== "playing") return;
    const p = this.player;
    if (!p.alive || p.grabbedBy) return;
    if (p.mounted) {
      p.setMounted(false);
      this.toast("You dismount and leave the horse behind", "info");
      return;
    }
    if (p.horses <= 0) {
      this.toast("No horses left — restock at a supply depot", "bad");
      return;
    }
    if (!p.grounded) {
      this.toast("Land first, then ride", "info");
      return;
    }
    p.horses--;
    p.setMounted(true);
    this.toast("Mounted — H to dismount. Riding is fast, but the hooks are off.", "good");
  }

  toggleMap() {
    if (this.phase !== "playing") return;
    this.mapOpen = !this.mapOpen;
    this.keys.clear();
    this.mouse[0] = this.mouse[1] = false;
  }

  /** Everything the Tab map needs to draw: rings, districts, depots, the gate, and every living unit. */
  mapSnapshot() {
    const p = this.player;
    return {
      mapR: MAP_R,
      rings: [
        { id: "maria", r: MARIA_R, name: "Wall Maria" },
        { id: "rose", r: ROSE_R, name: "Wall Rose" },
        { id: "sina", r: SINA_R, name: "Wall Sina" },
      ],
      gate: { x: SHIG_GATE.x, z: SHIG_GATE.z },
      districts: DISTRICTS.map((d) => ({ id: d.id, name: d.name, kind: d.kind, x: d.c.x, z: d.c.z, r: d.r })),
      depots: DEPOTS.map((d) => ({ id: d.id, name: d.name, x: d.c.x, z: d.c.z })),
      player: { x: p.pos.x, z: p.pos.z, alive: p.alive },
      squad: this.brains.map((b) => ({ id: b.scout.id, name: b.P.name, color: b.P.color, x: b.scout.pos.x, z: b.scout.pos.z, alive: b.scout.alive, named: this.brains.indexOf(b) < 5 })),
      titans: this.titans.filter((t) => t.alive).map((t) => ({ kind: t.kind, x: t.pos.x, z: t.pos.z })),
    };
  }

  /** Sun, moon, sky and fog follow the in-game clock (see daynight.ts). */
  private applyDayNight() {
    const L = skyLight(this.dayT);
    const c = (rgb: [number, number, number]) => new THREE.Color(rgb[0], rgb[1], rgb[2]);
    const az = L.azimuth;
    const h = Math.max(L.elevation, 0.12);
    this.sun.position.set(this.player.pos.x + Math.cos(az) * 150, h * 170, this.player.pos.z + 50);
    this.sun.target.position.copy(this.player.pos);
    this.sun.color.copy(c(L.sunColor));
    this.sun.intensity = L.sunIntensity;
    this.hemi.color.copy(c(L.hemiSky));
    this.hemi.intensity = L.hemiIntensity;
    this.skyMat.uniforms.top.value.copy(c(L.skyTop));
    this.skyMat.uniforms.horizon.value.copy(c(L.skyHorizon));
    (this.scene.background as THREE.Color).copy(c(L.skyHorizon));
    (this.scene.fog as THREE.FogExp2).color.copy(c(L.skyHorizon));
  }

  render() {
    if (!this.renderer) return;
    const dt = 1 / 60;
    if (this.phase === "playing" && this.intro) this.introCamera();
    else if (this.phase === "playing") this.updateCamera(dt);
    else if (this.phase === "menu") {
      // slow orbit around the town for the title screen
      const a = performance.now() * 0.00008;
      this.camera.position.set(Math.cos(a) * 95, 42, Math.sin(a) * 95);
      this.camera.lookAt(0, 8, 0);
    }
    this.sky.position.copy(this.camera.position);
    this.applyDayNight();
    this.sun.target.position.copy(this.player.pos);
    // ropes
    this.fx.beginRopes();
    for (const s of this.scouts) {
      if (!s.alive) continue;
      for (let i = 0; i < 2; i++) {
        const h = s.hooks[i];
        if (h.state === "idle") continue;
        s.handPos(i, _w);
        this.fx.rope(_w, h.tip);
      }
    }
    this.fx.endRopes();
    const f = this.h / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
    this.fx.particles.setScale(f * this.renderer.getPixelRatio());
    this.renderer.render(this.scene, this.camera);
    this.drawOverlay();
    this.miniT -= dt;
    if (this.miniT <= 0) {
      this.miniT = 0.1;
      this.drawMinimap();
    }
  }

  private project(p: V3, out: { x: number; y: number }) {
    _v.copy(p).project(this.camera);
    out.x = (_v.x * 0.5 + 0.5) * this.w;
    out.y = (-_v.y * 0.5 + 0.5) * this.h;
    return _v.z < 1 && _v.z > -1;
  }

  private drawOverlay() {
    const g = this.octx;
    if (!g || !this.overlay) return;
    const dpr = this.overlay.width / this.w;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, this.w, this.h);
    if (this.phase !== "playing" && this.phase !== "paused") return;
    const p = this.player;
    const W = this.w;
    const H = this.h;
    const cx = W / 2;
    const cy = H / 2;
    const focal = H / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
    const pt = { x: 0, y: 0 };

    // speed lines
    const sp = p.speed;
    if (sp > 24) {
      const a = clamp((sp - 24) / 30, 0, 0.5);
      g.strokeStyle = `rgba(255,255,255,${a})`;
      g.lineWidth = 1.5;
      for (let i = 0; i < 22; i++) {
        const ang = Math.random() * Math.PI * 2;
        const r0 = Math.min(W, H) * (0.34 + Math.random() * 0.25);
        const r1 = r0 + 40 + Math.random() * 90 * a;
        g.beginPath();
        g.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0);
        g.lineTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1);
        g.stroke();
      }
    }

    // nape markers
    g.textAlign = "center";
    g.font = "600 11px ui-monospace, monospace";
    for (const t of this.titans) {
      if (!t.alive) continue;
      const d = this.camera.position.distanceTo(t.nape);
      if (d > 130) continue;
      if (this.project(t.nape, pt)) {
        const r = clamp((t.napeR * focal) / Math.max(1, d), 7, 46);
        const dn = p.pos.distanceTo(t.nape);
        const ready = p.speed >= p.killSpeed;
        const inReach = dn < 3.4 + t.napeR + 1.5;
        g.lineWidth = inReach ? 3 : 2;
        g.strokeStyle = inReach && ready ? "#5dff8a" : inReach ? "#ffd24a" : "rgba(255,70,50,0.85)";
        g.beginPath();
        g.arc(pt.x, pt.y, r, 0, Math.PI * 2);
        g.stroke();
        g.beginPath();
        g.moveTo(pt.x - r - 4, pt.y);
        g.lineTo(pt.x - r * 0.45, pt.y);
        g.moveTo(pt.x + r + 4, pt.y);
        g.lineTo(pt.x + r * 0.45, pt.y);
        g.stroke();
        g.fillStyle = "rgba(255,255,255,0.85)";
        g.fillText(`${Math.round(t.height)}m${t.abnormal ? " ABN" : ""} · ${Math.round(dn)}m`, pt.x, pt.y - r - 8);
      }
      // strike warning
      if (t.target === p && (t.state === "windup" || t.state === "leap")) {
        _w.set(t.pos.x, t.pos.y + t.height * 1.05, t.pos.z);
        if (this.project(_w, pt)) {
          g.fillStyle = "#ff3b2a";
          g.font = "900 34px system-ui";
          g.fillText("!", pt.x, pt.y);
          g.font = "600 11px ui-monospace, monospace";
        }
      }
    }

    // squad tags
    for (const b of this.brains) {
      const s = b.scout;
      if (!s.alive) continue;
      _w.set(s.pos.x, s.pos.y + 1.6, s.pos.z);
      const d = this.camera.position.distanceTo(_w);
      if (d > 220 || !this.project(_w, pt)) continue;
      g.font = "700 12px system-ui";
      g.fillStyle = b.P.color;
      g.fillText(b.P.name, pt.x, pt.y - 8);
      const bw = 38;
      g.fillStyle = "rgba(0,0,0,0.55)";
      g.fillRect(pt.x - bw / 2, pt.y - 4, bw, 4);
      g.fillStyle = b.P.color;
      g.fillRect(pt.x - bw / 2, pt.y - 4, (bw * s.hp) / s.maxHp, 4);
      if (s.grabbedBy) {
        g.fillStyle = Math.floor(this.time * 6) % 2 ? "#ff3b2a" : "#ffffff";
        g.font = "900 14px system-ui";
        g.fillText("GRABBED!", pt.x, pt.y - 24);
      }
    }

    // crosshair
    const col = this.aimKind === "nape" ? "#ff4a3a" : this.aimKind === "titan" ? "#ffb347" : this.aimKind === "hook" ? "#6dffb0" : "rgba(255,255,255,0.55)";
    g.strokeStyle = col;
    g.lineWidth = 2;
    g.beginPath();
    g.arc(cx, cy, 11, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = col;
    g.beginPath();
    g.arc(cx, cy, 2, 0, Math.PI * 2);
    g.fill();
    for (let i = 0; i < 2; i++) {
      const hk = p.hooks[i];
      g.fillStyle = hk.state === "attached" ? "#6dffb0" : hk.state === "flying" ? "#ffd24a" : "rgba(255,255,255,0.25)";
      g.beginPath();
      g.arc(cx + (i === 0 ? -22 : 22), cy, 3.5, 0, Math.PI * 2);
      g.fill();
    }
    if (this.aim.hit && this.aimKind !== "none") {
      g.fillStyle = "rgba(255,255,255,0.7)";
      g.font = "600 10px ui-monospace, monospace";
      g.fillText(`${Math.round(this.aim.hit.dist)}m`, cx, cy + 28);
    }

    // hurt vignette
    if (p.hurtFlash > 0) {
      const gr = g.createRadialGradient(cx, cy, Math.min(W, H) * 0.3, cx, cy, Math.max(W, H) * 0.75);
      gr.addColorStop(0, "rgba(255,0,0,0)");
      gr.addColorStop(1, `rgba(255,0,0,${clamp(p.hurtFlash * 1.4, 0, 0.55)})`);
      g.fillStyle = gr;
      g.fillRect(0, 0, W, H);
    }
  }

  private drawMinimap() {
    const g = this.mctx;
    const c = this.mini;
    if (!g || !c) return;
    const S = c.width;
    const span = 130;
    const k = S / (span * 2);
    const X = (x: number) => (x + span) * k;
    const Y = (z: number) => (span - z) * k;
    g.clearRect(0, 0, S, S);
    g.fillStyle = "rgba(10,16,22,0.78)";
    g.fillRect(0, 0, S, S);
    g.fillStyle = "#5a5f66";
    for (const b of this.world.boxes) {
      g.fillStyle = b.kind === "wall" ? "#8a8f96" : b.kind === "gate" ? "#9aa0a8" : "#4b5159";
      g.fillRect(X(b.minX), Y(b.maxZ), (b.maxX - b.minX) * k, (b.maxZ - b.minZ) * k);
    }
    g.fillStyle = "#59e0ff";
    for (const d of this.world.depots) g.fillRect(X(d.pos.x) - 3, Y(d.pos.z) - 3, 6, 6);
    for (const t of this.titans) {
      if (!t.alive) continue;
      g.fillStyle = t.abnormal ? "#ff9d2e" : "#ff4a3a";
      g.beginPath();
      g.arc(X(t.pos.x), Y(t.pos.z), 2.5 + t.height * 0.25, 0, Math.PI * 2);
      g.fill();
      if (t.grabbed) {
        g.strokeStyle = "#fff";
        g.lineWidth = 1.5;
        g.stroke();
      }
    }
    for (const b of this.brains) {
      if (!b.scout.alive) continue;
      g.fillStyle = b.P.color;
      g.beginPath();
      g.arc(X(b.scout.pos.x), Y(b.scout.pos.z), 3.5, 0, Math.PI * 2);
      g.fill();
      if (b.scout.grabbedBy) {
        g.strokeStyle = "#ff3b2a";
        g.lineWidth = 2;
        g.beginPath();
        g.arc(X(b.scout.pos.x), Y(b.scout.pos.z), 7 + Math.sin(this.time * 8) * 2, 0, Math.PI * 2);
        g.stroke();
      }
    }
    // player + view cone
    const px = X(this.player.pos.x);
    const py = Y(this.player.pos.z);
    const ang = Math.atan2(-Math.cos(this.camYaw), Math.sin(this.camYaw));
    g.fillStyle = "rgba(255,255,255,0.18)";
    g.beginPath();
    g.moveTo(px, py);
    g.arc(px, py, 34, ang - 0.6, ang + 0.6);
    g.closePath();
    g.fill();
    g.fillStyle = "#ffffff";
    g.beginPath();
    g.arc(px, py, 4, 0, Math.PI * 2);
    g.fill();
  }

  // ------------------------------------------------------------------ HUD
  snapshot(): Snapshot {
    const p = this.player;
    let danger = 0;
    for (const t of this.titans) {
      if (!t.alive || t.target !== p) continue;
      const d = Math.hypot(t.pos.x - p.pos.x, t.pos.z - p.pos.z);
      danger = Math.max(danger, clamp(1 - d / 40, 0, 1));
    }
    const grabbedBy = p.grabbedBy;
    return {
      phase: this.phase,
      hp: p.hp,
      maxHp: p.maxHp,
      gas: p.gas,
      blade: p.bladeDur,
      spare: p.spare,
      spears: p.spears,
      swap: p.swapT > 0 ? 1 - p.swapT / 1.1 : 0,
      speed: p.speed,
      killSpeed: p.killSpeed,
      wave: this.wave,
      titansLeft: this.titans.filter((t) => t.alive).length,
      kills: this.kills,
      napeKills: this.napeKills,
      score: this.score,
      waveClear: this.waveState === "clear",
      waveTimer: this.waveTimer,
      grabbed: !!grabbedBy,
      struggle: p.struggle,
      eatProgress: 0,
      squad: this.brains.slice(0, 5).map((b) => ({
        id: b.scout.id,
        name: b.P.name,
        title: b.P.title,
        color: b.P.color,
        hp: b.scout.hp,
        maxHp: b.scout.maxHp,
        gas: b.scout.gas,
        alive: b.scout.alive,
        label: stateLabel(b.P.kind, b.state),
        kills: b.scout.kills,
        alert: !!b.scout.grabbedBy,
      })),
      hooks: [p.hooks[0].state, p.hooks[1].state],
      aim: this.aimKind,
      aimDist: this.aim.hit ? this.aim.hit.dist : 0,
      danger,
      hurt: p.hurtFlash,
      resupplying: this.resupplying,
      lock: this.lockActive ? "locked" : this.edgePan ? "edge" : "none",
      deathCause: this.deathCause,
      intro: this.intro ? { kicker: this.intro.kicker, title: this.intro.title, body: this.intro.body, forecast: this.intro.forecast, left: this.intro.t / INTRO_SECONDS } : null,
      mapOpen: this.mapOpen,
      horses: p.horses,
      mounted: p.mounted,
      clock: clockLabel(this.dayT),
      period: periodName(this.dayT),
    };
  }
}
