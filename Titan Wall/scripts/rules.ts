/* Economy rules test. Usage: npx tsx scripts/rules.ts
 *  - healing only ticks above 75 HP, and it is slow,
 *  - a depot gives nothing while a titan is too close, and works again once the titan is gone. */
import { Game } from "../src/game/game";

let fails = 0;
const check = (ok: boolean, msg: string) => {
  console.log((ok ? "PASS " : "FAIL ") + msg);
  if (!ok) fails++;
};
const g = new Game({ onToast: () => {} });
g.start();
const a = g as any;
const p = g.player;
const dep = g.world.depots[0];
g.titans.splice(0);
g.brains.forEach((b) => (b.scout.alive = false));

// 1. healing: above 75 it ticks, below it does not
p.invuln = 99;
p.pos.set(dep.pos.x + 200, 1, dep.pos.z + 200);
p.hp = 60;
for (let i = 0; i < 600; i++) { p.pos.set(dep.pos.x + 200, 1, dep.pos.z + 200); g.update(1 / 60); }
check(p.hp === 60, `no healing at 60 HP (hp ${p.hp.toFixed(2)})`);
p.hp = 80;
for (let i = 0; i < 600; i++) { p.pos.set(dep.pos.x + 200, 1, dep.pos.z + 200); g.update(1 / 60); }
const gain = p.hp - 80;
check(gain > 0.5 && gain < 4, `slow healing above 75 HP (+${gain.toFixed(2)} in 10 s)`);

// 1b. below 75 HP, passive healing is off but a depot still heals
p.hp = 40;
p.pos.set(dep.pos.x, 1, dep.pos.z);
for (let i = 0; i < 300; i++) { p.pos.set(dep.pos.x, 1, dep.pos.z); g.update(1 / 60); }
check(p.hp > 50, `depot heals below 75 HP (40 -> ${p.hp.toFixed(1)} in 5 s)`);
p.hp = 40;
for (let i = 0; i < 300; i++) { p.pos.set(dep.pos.x + 200, 1, dep.pos.z + 200); g.update(1 / 60); }
check(p.hp === 40, "no passive healing below 75 HP away from a depot");

// 2. depot: resupply + heal while no titan is near
p.hp = 80; p.gas = 10; p.spare = 0;
p.pos.set(dep.pos.x, 1, dep.pos.z);
for (let i = 0; i < 120; i++) { p.pos.set(dep.pos.x, 1, dep.pos.z); g.update(1 / 60); }
const openGas = p.gas;
check(openGas > 10, `depot restores gas when clear (${openGas.toFixed(1)})`);

// 3. same depot with a titan standing next to it: nothing happens
p.gas = 10; p.spare = 0; p.hp = 90;
const { Titan } = await import("../src/game/titan");
const _unused = 0; void _unused;
const t = new Titan(12, false, new (await import("three")).Vector3(dep.pos.x + 10, 0, dep.pos.z));
g.titans.push(t);
g.scene.add(t.model);
for (let i = 0; i < 120; i++) { p.pos.set(dep.pos.x, 1, dep.pos.z); t.pos.set(dep.pos.x + 10, 0, dep.pos.z); t.state = "recover"; (t as any).recDur = 99; g.update(1 / 60); }
check(p.gas < openGas, `depot locked while a titan is close (gas ${p.gas.toFixed(1)})`);
check(p.spare === 0, "no blade resupply while locked");
// 4. grab rules: no grab while another titan is in arm's reach, and none right after a release
const V = (await import("three")).Vector3;
const sc = g.player;
const t1 = new Titan(12, false, new V(dep.pos.x + 300, 0, dep.pos.z));
const t2 = new Titan(12, false, new V(dep.pos.x + 306, 0, dep.pos.z));
g.titans.push(t1, t2);
g.scene.add(t1.model, t2.model);
sc.pos.set(dep.pos.x + 303, 3, dep.pos.z);
check(!t1.canGrab(sc, g), "no grab while an adjacent titan is within reach");
t2.alive = false;
check(t1.canGrab(sc, g), "grab allowed when the neighbour is gone");
sc.grabImmune = 3;
check(!t1.canGrab(sc, g), "no grab during post-release immunity");
console.log(fails ? `${fails} FAILED` : "ALL PASSED");
process.exit(fails ? 1 : 0);
