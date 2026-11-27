import * as THREE from "three";

export const V3 = THREE.Vector3;
export type V3 = THREE.Vector3;
export type Vec3 = THREE.Vector3;

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const damp = (a: number, b: number, lambda: number, dt: number) =>
  lerp(a, b, 1 - Math.exp(-lambda * dt));
export const rand = (a: number, b: number) => a + Math.random() * (b - a);
export function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function angleDiff(a: number, b: number) {
  const TAU = Math.PI * 2;
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

export function turnToward(cur: number, target: number, maxStep: number) {
  return cur + clamp(angleDiff(cur, target), -maxStep, maxStep);
}

/** Yaw 0 faces +Z. Positive yaw turns toward +X. */
export function fwdOf(yaw: number, out: Vec3) {
  return out.set(Math.sin(yaw), 0, Math.cos(yaw));
}
/** Right-hand side of an entity facing `yaw` (forward x up). */
export function rightOf(yaw: number, out: Vec3) {
  return out.set(-Math.cos(yaw), 0, Math.sin(yaw));
}

export class RNG {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0;
  }
  next() {
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number) {
    return a + this.next() * (b - a);
  }
  pick<T>(arr: T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
}

export const DIRS = ["ahead", "to your right", "behind you", "to your left"];
/** Describe where `target` is relative to something at `from` facing `yaw`. */
export function relativeDir(from: Vec3, yaw: number, target: Vec3) {
  const a = angleDiff(yaw, Math.atan2(target.x - from.x, target.z - from.z));
  // a>0 => target is to the left (yaw increases leftwards)
  const deg = (a * 180) / Math.PI;
  if (Math.abs(deg) < 45) return "ahead";
  if (Math.abs(deg) > 135) return "behind you";
  return deg > 0 ? "to your left" : "to your right";
}
