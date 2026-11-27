import type * as THREE from "three";
import type { World, Box } from "./world";
import type { Scout } from "./scout";
import type { Titan } from "./titan";
import type { FX } from "./fx";

export interface RayHit {
  dist: number;
  point: THREE.Vector3;
  normal: THREE.Vector3;
  kind: "ground" | "box" | "titan";
  box?: Box;
  titan?: Titan;
}

export type BarkKey =
  | "wave_start"
  | "spot_titan"
  | "spot_abnormal"
  | "threat_player"
  | "player_low_gas"
  | "player_low_blades"
  | "player_hurt"
  | "kill"
  | "praise"
  | "ally_grabbed"
  | "grabbed"
  | "rescued"
  | "thanks"
  | "out_of_gas"
  | "blades_broken"
  | "resupply"
  | "crash"
  | "panic"
  | "hesitate"
  | "rush"
  | "rescue_go"
  | "flank"
  | "dive"
  | "wave_clear"
  | "reinforce"
  | "player_down"
  | "idle";

/** World services exposed to scouts, titans and bot brains. */
export interface Sim {
  world: World;
  scouts: Scout[];
  titans: Titan[];
  fx: FX;
  time: number;
  rayWorld(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, includeTitans: boolean): RayHit | null;
  noise(pos: THREE.Vector3, radius: number, src: Scout | null): void;
  bark(scout: Scout, key: BarkKey, vars?: Record<string, string | number>): void;
  onGrab(scout: Scout, titan: Titan): void;
  onSwat(scout: Scout, titan: Titan): void;
  onEaten(scout: Scout, titan: Titan): void;
  onCrash(scout: Scout, impact: number, damage: number): void;
  onScoutDied(scout: Scout, cause: string): void;
  onTitanKilled(titan: Titan, by: Scout | null): void;
  toast(text: string, kind?: "info" | "good" | "bad" | "kill"): void;
}
