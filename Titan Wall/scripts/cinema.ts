// Wave title cards, the Tab map, the recruits, the clock and the hook assist.
import { Game } from "../src/game/game";
import { Scout } from "../src/game/scout";
import * as THREE from "three";

let fails = 0;
const check = (ok: boolean, msg: string) => {
  console.log(ok ? "PASS" : "FAIL", msg);
  if (!ok) fails++;
};

// --- 1. recruits and the squad roster
const g: any = new Game({ onToast: () => {} });
g.start();
g.titans.splice(0);
check(g.brains.length >= 50 + 5, `squad has the named five plus recruits (${g.brains.length})`);
const ok = g.brains.every((b: any) => Number.isFinite(b.scout.pos.x) && Number.isFinite(b.scout.pos.z));
check(ok, "every teammate has a finite spawn position");
const names = new Set(g.brains.map((b: any) => b.P.name));
check(names.size === g.brains.length, "every teammate has a unique name");
const recruitsInMaria = g.brains.slice(5).every((b: any) => Math.hypot(b.scout.pos.x, b.scout.pos.z) > 3000);
check(recruitsInMaria, "recruits spawn across Wall Maria, not at the start");

// --- 2. wave title card: shows on wave start when cinematics are on, freezes the sim, then clears
g.setCinematics(true);
g.startWave ? null : null;
(g as any).startWave(3);
check(!!g.intro && g.intro.kicker.includes("WAVE 3"), "a title card appears when wave 3 starts");
const before = g.titans.map((t: any) => t.pos.x).join(",");
for (let i = 0; i < 60; i++) g.update(1 / 60);
const after = g.titans.map((t: any) => t.pos.x).join(",");
check(before === after, "the simulation is frozen while the title card is up");
const snap = g.snapshot();
check(snap.intro && snap.intro.title.length > 0, "the HUD snapshot carries the title card");
g.skipIntro();
check(g.intro === null, "skipping the card clears it");
g.update(1 / 60);
check(g.intro === null, "the card stays cleared");
g.setCinematics(false);

// --- 3. Tab map: holds the sim, and the map snapshot has the full world
g.toggleMap();
check(g.mapOpen === true, "Tab opens the map");
const p0 = g.player.pos.clone();
for (let i = 0; i < 60; i++) g.update(1 / 60);
check(p0.distanceTo(g.player.pos) < 1e-6, "the simulation holds while the map is open");
const m = g.mapSnapshot();
check(m.mapR === 13500 && m.rings.length === 3, "map has the 27 km region and three walls");
check(m.districts.length >= 10 && m.depots.length >= 1, `map lists districts (${m.districts.length}) and depots (${m.depots.length})`);
check(m.squad.length === g.brains.length, "map lists every teammate");
g.toggleMap();
check(g.mapOpen === false, "Tab closes the map");

// --- 4. day and night reaches the HUD clock and advances while playing
const c0 = g.snapshot().clock;
for (let i = 0; i < 60 * 60; i++) g.update(1 / 60);
check(g.snapshot().clock !== c0, `the clock moves during play (${c0} to ${g.snapshot().clock})`);
check(["Dawn", "Day", "Dusk", "Night"].includes(g.snapshot().period), "the HUD has a time-of-day name");

// --- 5. hook assist: a hook aimed just off a solid target still catches it for the player
const stubSim: any = {
  rayWorld: (o: THREE.Vector3, d: THREE.Vector3) => {
    // a single wall face straight ahead (+z), 6 units in from the origin, only 2 units wide, so a 12 degree miss is a real miss
    const dz = d.z;
    if (dz <= 0.5) return null;
    const t = 6 / dz;
    const p = new THREE.Vector3().copy(o).addScaledVector(d, t);
    if (Math.abs(p.x) > 1) return null;
    return { kind: "building", point: p, dist: t, titan: null };
  },
  noise: () => {},
};
const player = new Scout({ id: "t", name: "T", isPlayer: true, palette: { cloak: 0, hair: 0, accent: 0 }, maxHp: 100, killSpeed: 12, dmgMult: 1 } as any);
player.reset(new THREE.Vector3(0, 1, 0));
const aim = new THREE.Vector3(0.22, 0, 1).normalize(); // about 12 degrees off the wall's normal
(player as any).fireHook(0, aim, stubSim);
check((player as any).hooks[0].missed === false, "a hook aimed 12 degrees off the wall still catches it (assist)");
const npc = new Scout({ id: "n", name: "N", isPlayer: false, palette: { cloak: 0, hair: 0, accent: 0 }, maxHp: 100, killSpeed: 12, dmgMult: 1 } as any);
npc.reset(new THREE.Vector3(0, 1, 0));
(npc as any).fireHook(0, aim, stubSim);
check((npc as any).hooks[0].missed === true, "teammates get no assist (the player only)");

console.log(fails ? `${fails} FAILED` : "ALL PASSED");
process.exit(fails ? 1 : 0);
