// Specialist titans: distinct tuning, distinct models, and the wave-60 bosses can be killed by a clean nape cut.
import * as THREE from "three";
import { Game } from "../src/game/game";
import { Titan } from "../src/game/titan";
import type { SpawnKind } from "../src/game/waves";

let fails = 0;
const check = (ok: boolean, label: string) => {
  if (!ok) fails++;
  console.log(ok ? "PASS" : "FAIL", label);
};

const kinds: SpawnKind[] = ["normal", "abnormal", "beast", "reiss", "hammer", "founding"];
const sizes: Record<SpawnKind, number> = { normal: 12, abnormal: 11, armored: 14, colossal: 48, beast: 28, reiss: 46, hammer: 34, founding: 60 };
const built: Record<string, Titan> = {};
for (const k of kinds) built[k] = new Titan(sizes[k], k === "abnormal", new THREE.Vector3(0, 0, 0), k);

// 1. tuning ordering
const b = built;
check(b.beast.runSpeed > b.normal.runSpeed, `beast runs faster than a normal (${b.beast.runSpeed.toFixed(1)} > ${b.normal.runSpeed.toFixed(1)})`);
check(b.beast.runSpeed > b.reiss.runSpeed && b.reiss.runSpeed > b.hammer.runSpeed && b.hammer.runSpeed > b.founding.runSpeed, "run speed: beast > reiss > hammer > founding");
check(b.founding.turnRate < b.hammer.turnRate && b.hammer.turnRate < b.reiss.turnRate, "turn rate: founding < hammer < reiss");
check(b.founding.reach > b.hammer.reach && b.hammer.reach > b.normal.reach, "reach: founding > hammer > normal");
check(b.hammer.hitR > 0 && b.founding.hitR > b.hammer.hitR && b.normal.hitR === 0, "hammer and founding swings are wider");
for (const k of kinds) check(b[k].hp > 0 && b[k].alive, `${k} spawns alive with ${b[k].hp} HP`);

// 2. distinct models: the body's child count and material colour differ from a normal
// Signature: bounding box (rounded) plus the set of material colours, so a silhouette change or a new prop shows up.
const sig = (t: Titan) => {
  const box = new THREE.Box3().setFromObject(t.model);
  const size = box.getSize(new THREE.Vector3());
  const cols = new Set<number>();
  t.model.traverse((o: any) => { if (o.isMesh && o.material?.color) cols.add(o.material.color.getHex()); });
  return `${size.x.toFixed(2)}x${size.y.toFixed(2)}|${cols.size}`;
};
const sigs = kinds.map((k) => `${k}:${sig(b[k])}`);
check(new Set(kinds.map((k) => sig(b[k]))).size === kinds.length, `models are visually distinct (${sigs.join(" ")})`);
let reissHidden = 0;
b.reiss.model.traverse((o: any) => { if (o.visible === false) reissHidden++; });
check(reissHidden > 0, `Reiss hides its face features (${reissHidden} hidden parts)`);

// 3. winnability: a fast clean nape cut from behind kills each boss, a slow one only chips plate
const g = new Game({ onToast: () => {} });
g.start();
const a = g as any;
const p = g.player;
const dt = 1 / 60;
const boss = b.founding;
const cut = (T: Titan, speed: number, label: string) => {
  g.titans.splice(0);
  T.alive = true; T.hp = T.kind === "founding" ? 1500 : 650; (T as any).state = "recover"; (T as any).recDur = 99;
  T.pos.set(9000, 0, 0); T.yaw = 0;
  g.titans.push(T);
  for (const bb of g.brains) { bb.scout.alive = false; bb.scout.model.visible = false; }
  g.update(dt);
  const n = T.nape;
  let hits = 0;
  // one fast pass from behind the nape at the requested speed, repeated until the boss dies or 40 passes
  for (let i = 0; i < 40 && T.alive; i++) {
    p.pos.set(n.x, n.y, n.z - 3.2); p.vel.set(0, 0, speed); p.bladeDur = 100; p.invuln = 5; p.slashHit = false;
    a.pendSlash = true;
    g.update(dt);
    hits++;
    (T as any).state = "recover"; (T as any).recDur = 99;
  }
  console.log(`   ${label}: alive=${T.alive} hp=${T.hp.toFixed(0)} passes=${hits}`);
  return !T.alive;
};
const killSpeed = a.player.killSpeed as number;
console.log("killSpeed", killSpeed);
const slowKills = cut(new Titan(60, false, new THREE.Vector3(), "founding"), killSpeed * 0.7, "founding, sub-kill speed");
check(!slowKills, "founding cannot be killed by a sub-kill swing");
const fastKill = cut(new Titan(60, false, new THREE.Vector3(), "founding"), Math.min(49, killSpeed * 1.5), "founding, clean fast cut");
check(fastKill, "founding dies to a clean fast nape cut");
const hamKill = cut(new Titan(34, false, new THREE.Vector3(), "hammer"), Math.min(49, killSpeed * 1.5), "hammer, clean fast cut");
check(hamKill, "hammer dies to a clean fast nape cut");
const beastKill = cut(new Titan(28, false, new THREE.Vector3(), "beast"), killSpeed * 1.25, "beast, clean cut");
check(beastKill, "beast dies to a clean nape cut");

console.log(fails === 0 ? "ALL PASSED" : `${fails} FAILED`);
if (fails) process.exitCode = 1;
