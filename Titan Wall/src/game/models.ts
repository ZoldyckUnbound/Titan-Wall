import * as THREE from "three";
import type { SpawnKind } from "./waves";
import { loaded, instantiateByHeight } from "./assets";

const geoCache = new Map<string, THREE.BufferGeometry>();
function box(w: number, h: number, d: number) {
  const k = `b${w},${h},${d}`;
  let g = geoCache.get(k);
  if (!g) geoCache.set(k, (g = new THREE.BoxGeometry(w, h, d)));
  return g;
}
function capsule(r: number, len: number) {
  const k = `c${r},${len}`;
  let g = geoCache.get(k);
  if (!g) geoCache.set(k, (g = new THREE.CapsuleGeometry(r, len, 4, 8)));
  return g;
}
function sphere(r: number, ws = 12, hs = 10) {
  const k = `s${r},${ws},${hs}`;
  let g = geoCache.get(k);
  if (!g) geoCache.set(k, (g = new THREE.SphereGeometry(r, ws, hs)));
  return g;
}
function cyl(rt: number, rb: number, h: number, seg = 10) {
  const k = `y${rt},${rb},${h},${seg}`;
  let g = geoCache.get(k);
  if (!g) geoCache.set(k, (g = new THREE.CylinderGeometry(rt, rb, h, seg)));
  return g;
}

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  parent.add(m);
  return m;
}

const std = (color: number, rough = 0.85, metal = 0) =>
  new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });

// ---------------------------------------------------------------------------------------- SCOUT
export interface ScoutPalette {
  cloak: number;
  hair: number;
  accent: number;
  accentOnHead?: boolean;
  skin?: number;
}
export interface ScoutParts {
  root: THREE.Group;
  tilt: THREE.Group;
  legL?: THREE.Group;
  legR?: THREE.Group;
  armL?: THREE.Group;
  armR?: THREE.Group;
  cape?: THREE.Group;
  bladeMat?: THREE.MeshStandardMaterial;
  blades?: THREE.Mesh[];
  gasL?: THREE.Object3D;
  gasR?: THREE.Object3D;
}

/** Scout model. Origin = body centre; feet sit 0.85 m below. Faces +Z. */
export function buildScout(p: ScoutPalette): ScoutParts {
  const root = new THREE.Group();
  const tilt = new THREE.Group();
  root.add(tilt);

  const jacket = std(0x6a4a30);
  const strap = std(0x2f2217);
  const steel = std(0x50555e, 0.4, 0.6);
  const skin = std(p.skin ?? 0xe8c4a0, 0.8);
  const white = std(0xe8e3d4);
  const cloakMat = new THREE.MeshStandardMaterial({ color: p.cloak, roughness: 0.9, side: THREE.DoubleSide });

  // Stand-in hook: swap in a rigged GLB for the whole body if provided
  if (loaded.scout) {
    const inst = instantiateByHeight(loaded.scout, 1.75);
    inst.position.y = -0.85;
    tilt.add(inst);
    const gasL = new THREE.Object3D();
    gasL.position.set(-0.3, -0.2, -0.2);
    const gasR = new THREE.Object3D();
    gasR.position.set(0.3, -0.2, -0.2);
    tilt.add(gasL, gasR);
    return { root, tilt, gasL, gasR };
  }

  mesh(box(0.52, 0.7, 0.3), jacket, 0, 0.1, 0, tilt);
  mesh(box(0.08, 0.72, 0.32), strap, 0.13, 0.1, 0, tilt);
  mesh(box(0.08, 0.72, 0.32), strap, -0.13, 0.1, 0, tilt);
  mesh(box(0.54, 0.09, 0.32), strap, 0, -0.2, 0, tilt); // belt
  // 3D manoeuvre gear
  mesh(box(0.32, 0.22, 0.12), steel, 0, -0.08, -0.22, tilt);
  const gasL = new THREE.Group();
  gasL.position.set(-0.32, -0.22, 0.02);
  const gasR = new THREE.Group();
  gasR.position.set(0.32, -0.22, 0.02);
  for (const g of [gasL, gasR]) {
    mesh(cyl(0.07, 0.07, 0.3, 8), steel, 0, 0, 0, g);
    g.children[0].rotation.x = Math.PI / 2;
    tilt.add(g);
  }
  // scarf / headband accent
  if (p.accentOnHead) {
    mesh(cyl(0.2, 0.2, 0.06, 12), std(p.accent), 0, 0.74, 0, tilt);
  } else {
    mesh(cyl(0.17, 0.21, 0.11, 10), std(p.accent), 0, 0.5, 0, tilt);
  }
  // head
  mesh(sphere(0.18), skin, 0, 0.68, 0, tilt);
  const hair = mesh(new THREE.SphereGeometry(0.2, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.58), std(p.hair, 0.95), 0, 0.7, -0.015, tilt);
  hair.rotation.x = -0.3;
  mesh(box(0.05, 0.035, 0.03), std(0x15110e), 0.07, 0.69, 0.165, tilt);
  mesh(box(0.05, 0.035, 0.03), std(0x15110e), -0.07, 0.69, 0.165, tilt);

  // cloak (pivot at shoulders so it can flutter)
  const cape = new THREE.Group();
  cape.position.set(0, 0.44, -0.17);
  tilt.add(cape);
  mesh(box(0.62, 0.95, 0.03), cloakMat, 0, -0.47, -0.02, cape);
  mesh(box(0.14, 0.2, 0.035), std(0xf2f2f2), -0.07, -0.26, -0.045, cape); // emblem wings
  mesh(box(0.14, 0.2, 0.035), std(0x2b4a8a), 0.07, -0.26, -0.045, cape);

  // legs
  const legL = new THREE.Group();
  legL.position.set(-0.13, -0.25, 0);
  const legR = new THREE.Group();
  legR.position.set(0.13, -0.25, 0);
  for (const l of [legL, legR]) {
    mesh(box(0.18, 0.5, 0.2), white, 0, -0.25, 0, l);
    mesh(box(0.2, 0.14, 0.3), std(0x2a2019), 0, -0.54, 0.04, l);
    tilt.add(l);
  }

  // arms + twin blades
  const bladeMat = new THREE.MeshStandardMaterial({
    color: 0xdfe5ee,
    roughness: 0.2,
    metalness: 0.9,
    emissive: 0x334455,
    emissiveIntensity: 0.4,
  });
  const blades: THREE.Mesh[] = [];
  const mkArm = (x: number) => {
    const a = new THREE.Group();
    a.position.set(x, 0.35, 0);
    mesh(box(0.13, 0.5, 0.14), jacket, 0, -0.22, 0, a);
    mesh(sphere(0.07, 8, 6), std(0xd8cdb8), 0, -0.5, 0, a);
    mesh(box(0.06, 0.06, 0.22), std(0x2a2a2e), 0, -0.5, 0.06, a);
    const b = mesh(box(0.025, 0.08, 1.15), bladeMat, 0, -0.5, 0.72, a);
    b.castShadow = false;
    blades.push(b);
    a.rotation.x = -0.5;
    tilt.add(a);
    return a;
  };
  const armL = mkArm(-0.33);
  const armR = mkArm(0.33);

  return { root, tilt, legL, legR, armL, armR, cape, bladeMat, blades, gasL, gasR };
}

// ---------------------------------------------------------------------------------------- TITAN
export interface TitanParts {
  root: THREE.Group;
  body: THREE.Group;
  hipL?: THREE.Group;
  hipR?: THREE.Group;
  kneeL?: THREE.Group;
  kneeR?: THREE.Group;
  shoulderL?: THREE.Group;
  shoulderR?: THREE.Group;
  elbowL?: THREE.Group;
  elbowR?: THREE.Group;
  head?: THREE.Group;
  mouth?: THREE.Mesh;
  halo: THREE.Mesh;
  marker: THREE.Mesh;
}

const SKINS = [0xe4b79a, 0xd9a98b, 0xe9c6ad, 0xcf9d82, 0xdcb59a];
const HAIRS = [0x3a2c20, 0x1f1a17, 0x6b4a2a, 0x8a7a55, 0x2c2a2a];
export const NAPE_LOCAL = new THREE.Vector3(0, 0.835, -0.058);

/** Titan in unit-height space (feet at y=0, faces +Z); the root is scaled to the titan's height. */
export function buildTitan(
  height: number,
  abnormal: boolean,
  napeR: number,
  kind: SpawnKind = abnormal ? "abnormal" : "normal"
): TitanParts {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  root.scale.setScalar(height);

  // each specialist reads at a glance: beast = tawny and long-armed, Reiss = bone and faceless,
  // hammer = broad and armed, Founding = pale gold with a halo
  const skinCol =
    kind === "beast" ? 0x7d5b47 :
    kind === "reiss" ? 0xd9d0bd :
    kind === "founding" ? 0xf1e4c8 :
    abnormal ? 0xb99c8b : SKINS[Math.floor(Math.random() * SKINS.length)];
  const skin = std(skinCol, 0.75);
  const hairM = std(
    kind === "founding" ? 0xe8dcc0 : abnormal || kind === "beast" ? 0x151313 : HAIRS[Math.floor(Math.random() * HAIRS.length)],
    0.95
  );
  const dark = std(0x120d0d, 0.6);
  const white = std(0xf1ece0, 0.5);
  const mouthM = std(0x3a0f12, 0.6);
  const eyeWhite = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.4,
    emissive: abnormal ? 0x661111 : 0x111111,
  });

  const mk = (sx: number): [THREE.Group, THREE.Group] => {
    const hip = new THREE.Group();
    hip.position.set(sx * 0.065, 0.47, 0);
    body.add(hip);
    mesh(capsule(0.052, 0.16), skin, 0, -0.12, 0, hip);
    const knee = new THREE.Group();
    knee.position.y = -0.235;
    hip.add(knee);
    mesh(capsule(0.042, 0.15), skin, 0, -0.117, 0, knee);
    mesh(box(0.085, 0.025, 0.14), skin, 0, -0.226, 0.025, knee);
    return [hip, knee];
  };
  const [hipL, kneeL] = mk(-1);
  const [hipR, kneeR] = mk(1);

  mesh(box(0.19, 0.1, 0.11), skin, 0, 0.5, 0, body);
  mesh(box(0.27, 0.28, 0.14), skin, 0, 0.69, 0, body);
  if (kind === "hammer") mesh(box(0.36, 0.26, 0.18), skin, 0, 0.72, 0, body); // broad shoulders
  if (kind === "reiss") {
    // exposed ribs over a hollow chest
    for (const ry of [0.6, 0.66, 0.72, 0.78]) mesh(box(0.22, 0.012, 0.02), white, 0, ry, 0.085, body);
  }
  const sh = mesh(capsule(0.045, 0.27), skin, 0, 0.8, 0, body);
  sh.rotation.z = Math.PI / 2;
  mesh(cyl(0.035, 0.042, 0.065, 8), skin, 0, 0.845, 0, body);

  // head
  const head = new THREE.Group();
  head.position.set(0, 0.9, 0.005);
  body.add(head);
  const skull = mesh(sphere(0.075), skin, 0, 0, 0, head);
  skull.scale.set(1, 1.08, 1);
  mesh(box(0.1, 0.04, 0.09), skin, 0, -0.048, 0.012, head);
  mesh(box(0.015, 0.022, 0.022), skin, 0, -0.004, 0.076, head);
  const eyeS = abnormal ? 1.35 : 1;
  for (const s of [-1, 1]) {
    const ew = mesh(sphere(0.016 * eyeS, 8, 6), eyeWhite, s * 0.032, 0.018, 0.064, head);
    ew.castShadow = false;
    const ep = mesh(sphere(0.009 * eyeS, 6, 5), dark, s * 0.032, 0.018, 0.077, head);
    ep.castShadow = false;
  }
  const mouth = mesh(box(0.06, 0.012, 0.012), mouthM, 0, -0.036, 0.07, head);
  mouth.scale.set(abnormal ? 1.7 : 1, abnormal ? 2.2 : 1.3, 1);
  const teeth = mesh(box(0.055, 0.008, 0.01), white, 0, -0.029, 0.073, head);
  teeth.scale.x = abnormal ? 1.7 : 1;
  const hair = mesh(new THREE.SphereGeometry(0.083, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), hairM, 0, 0.008, -0.012, head);
  hair.rotation.x = -0.45;
  if (kind === "founding") hair.scale.set(1.25, 1.6, 1.25); // long flowing hair
  if (kind === "beast") mesh(box(0.05, 0.04, 0.07), skin, 0, -0.02, 0.078, head); // muzzle
  if (kind === "reiss") {
    // faceless: only the bare skull, no eyes, mouth or hair
    for (const c of head.children) if (c !== skull) c.visible = false;
  }
  if (kind === "founding") {
    // a gold halo above the head
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.15, 0.008, 6, 28),
      new THREE.MeshBasicMaterial({ color: 0xffe59a })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.set(0, 1.02, 0);
    body.add(ring);
  }

  // arms
  const mkArm = (sx: number): [THREE.Group, THREE.Group] => {
    const s = new THREE.Group();
    s.position.set(sx * 0.17, 0.79, 0);
    body.add(s);
    if (abnormal) s.scale.set(1, 1.25, 1);
    if (kind === "beast") s.scale.set(1.1, 1.7, 1.1); // long, hanging arms
    mesh(capsule(0.032, 0.1), skin, 0, -0.09, 0, s);
    const e = new THREE.Group();
    e.position.y = -0.18;
    s.add(e);
    mesh(capsule(0.028, 0.1), skin, 0, -0.09, 0, e);
    mesh(sphere(0.042, 8, 6), skin, 0, -0.2, 0.005, e);
    return [s, e];
  };
  const [shoulderL, elbowL] = mkArm(-1);
  const [shoulderR, elbowR] = mkArm(1);
  if (kind === "hammer") {
    // war hammer carried in the right hand: wooden haft and an iron head
    mesh(cyl(0.018, 0.018, 0.5, 6), std(0x5a3b22, 0.8), 0, -0.3, 0.02, elbowR);
    mesh(box(0.2, 0.14, 0.1), std(0x3b3a3d, 0.5, 0.6), 0, -0.56, 0.02, elbowR);
  }

  // nape weak-point: glowing marker + translucent hit-volume halo
  const marker = new THREE.Mesh(
    sphere(0.016, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xff3b2a })
  );
  marker.position.copy(NAPE_LOCAL);
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(napeR / height, 14, 10),
    new THREE.MeshBasicMaterial({
      color: 0xff3a22,
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  halo.position.copy(NAPE_LOCAL);
  halo.renderOrder = 6;
  body.add(marker, halo);

  const parts: TitanParts = {
    root, body, hipL, hipR, kneeL, kneeR, shoulderL, shoulderR, elbowL, elbowR, head, mouth, halo, marker,
  };

  const tpl = abnormal ? loaded.abnormal ?? loaded.titan : loaded.titan;
  if (tpl) {
    // Replace the procedural body with a GLB: hide procedural meshes but keep nape marker/halo.
    for (const c of [...body.children]) if (c !== marker && c !== halo) body.remove(c);
    body.add(instantiateByHeight(tpl, 1));
    return { root, body, halo, marker };
  }
  return parts;
}
