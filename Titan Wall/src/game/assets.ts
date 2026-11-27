import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";

/**
 * ASSET HOOKS
 * -----------
 * Sketchfab / CGTrader / Tripo / Mixamo all require an account login (and per-model licence
 * acceptance) to download, so the game ships with clean modular procedural meshes instead.
 *
 * To swap in real rigged models, drop .glb files in /public/models (or any URL) and either:
 *   1. fill in ASSET_MANIFEST below, or
 *   2. use query params:  ?scout=/models/scout.glb&titan=/models/titan.glb&abnormal=/models/abnormal.glb
 *   3. set window.__AOT_ASSETS__ = { scout: "...", titan: "...", buildings: ["..."] } before boot.
 *
 * Models are auto-normalised: scouts are scaled to ~1.75 m, titans to their rolled height,
 * buildings are stretched to the lot footprint. Models should face +Z with feet at y=0.
 * Anything that fails to load silently falls back to the procedural mesh.
 */
export interface AssetManifest {
  scout?: string;
  titan?: string;
  abnormal?: string;
  buildings?: string[];
}

export const ASSET_MANIFEST: AssetManifest = {
  scout: "",
  titan: "",
  abnormal: "",
  buildings: [],
};

export const loaded: {
  scout?: THREE.Object3D;
  titan?: THREE.Object3D;
  abnormal?: THREE.Object3D;
  buildings: THREE.Object3D[];
} = { buildings: [] };

function resolveManifest(): AssetManifest {
  const m: AssetManifest = { ...ASSET_MANIFEST, buildings: [...(ASSET_MANIFEST.buildings ?? [])] };
  if (typeof window === "undefined") return m;
  const w = (window as unknown as { __AOT_ASSETS__?: AssetManifest }).__AOT_ASSETS__;
  if (w) Object.assign(m, w);
  const q = new URLSearchParams(window.location.search);
  for (const k of ["scout", "titan", "abnormal"] as const) {
    const v = q.get(k);
    if (v) m[k] = v;
  }
  const b = q.get("buildings");
  if (b) m.buildings = b.split(",");
  return m;
}

export async function loadAssets(): Promise<{ ok: string[]; failed: string[] }> {
  const m = resolveManifest();
  const loader = new GLTFLoader();
  const ok: string[] = [];
  const failed: string[] = [];
  const load = async (url: string) => {
    try {
      const g = await loader.loadAsync(url);
      ok.push(url);
      return g.scene;
    } catch {
      failed.push(url);
      return undefined;
    }
  };
  const jobs: Promise<void>[] = [];
  if (m.scout) jobs.push(load(m.scout).then((o) => void (loaded.scout = o)));
  if (m.titan) jobs.push(load(m.titan).then((o) => void (loaded.titan = o)));
  if (m.abnormal) jobs.push(load(m.abnormal).then((o) => void (loaded.abnormal = o)));
  for (const u of m.buildings ?? [])
    if (u) jobs.push(load(u).then((o) => void (o && loaded.buildings.push(o))));
  await Promise.all(jobs);
  return { ok, failed };
}

/** Clone a template, scale to targetHeight, put feet at y=0 and centre on x/z. */
export function instantiateByHeight(template: THREE.Object3D, targetHeight: number): THREE.Group {
  const clone = SkeletonUtils.clone(template);
  const box = new THREE.Box3().setFromObject(clone);
  const size = box.getSize(new THREE.Vector3());
  const s = targetHeight / Math.max(0.0001, size.y);
  const wrap = new THREE.Group();
  clone.scale.multiplyScalar(s);
  const box2 = new THREE.Box3().setFromObject(clone);
  const c = box2.getCenter(new THREE.Vector3());
  clone.position.set(-c.x, -box2.min.y, -c.z);
  wrap.add(clone);
  clone.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return wrap;
}

/** Clone a template and non-uniformly stretch it to fit w x h x d sitting on the ground. */
export function instantiateByBox(template: THREE.Object3D, w: number, h: number, d: number): THREE.Group {
  const clone = SkeletonUtils.clone(template);
  const box = new THREE.Box3().setFromObject(clone);
  const size = box.getSize(new THREE.Vector3());
  clone.scale.set(w / Math.max(0.01, size.x), h / Math.max(0.01, size.y), d / Math.max(0.01, size.z));
  const box2 = new THREE.Box3().setFromObject(clone);
  const c = box2.getCenter(new THREE.Vector3());
  clone.position.set(-c.x, -box2.min.y, -c.z);
  const wrap = new THREE.Group();
  wrap.add(clone);
  clone.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return wrap;
}
