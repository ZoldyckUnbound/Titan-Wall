// Squad rules: teammates are distinct, have one life per engagement, rejoin at the next wave, retreat when low, and rarely crash.
import { Game } from "../src/game/game";

let fails = 0;
const check = (ok: boolean, label: string) => {
  if (!ok) fails++;
  console.log(ok ? "PASS" : "FAIL", label);
};

const g = new Game({ onToast: () => {} });
g.start();
const a = g as any;
const dt = 1 / 60;
g.titans.splice(0);
for (const b of g.brains) { b.scout.alive = true; }

// 1. roster
const bots = g.brains;
check(bots.length >= 5, `squad has ${bots.length} teammates`);
const kinds = new Set(bots.map((b) => b.P.kind));
check(kinds.size === bots.length, "every teammate has a distinct personality");
check(bots.every((b) => b.P.retreatAt > 0 && b.P.retreatAt < 1), "every teammate has a retreat threshold");
check(bots.every((b) => b.scout.crashScale <= 0.5), "teammates resist crashing (crashScale ≤ 0.5); player does not");
check(g.player.crashScale === 1, "player takes full crash damage");

// 2. one life per engagement: a downed teammate stays down through the wave, then rejoins at the next wave
const b0 = bots[0];
b0.scout.alive = false;
a.onScoutDied(b0.scout, "swat");
for (let i = 0; i < 120; i++) g.update(dt);
check(!b0.scout.alive, "a downed teammate stays down mid-wave (one life)");
a.startWave(2);
check(b0.scout.alive, "a downed teammate rejoins at the start of the next wave");
check(b0.scout.grabbedBy === null && b0.scout.hp === b0.scout.maxHp, "a reinforcement arrives at full HP");
const dx = b0.scout.pos.x - g.player.pos.x, dz = b0.scout.pos.z - g.player.pos.z;
check(Math.hypot(dx, dz) < 15, `a reinforcement lands near the player (${Math.hypot(dx, dz).toFixed(1)} m)`);

// 3. retreat when low: every teammate at 10% HP with no titan in sight goes to resupply
g.titans.splice(0);
for (const b of bots) {
  b.scout.hp = b.scout.maxHp * 0.1;
  b.scout.gas = b.scout.maxGas;
}
for (let i = 0; i < 40; i++) g.update(dt);
for (const b of bots) check(b.state === "resupply", `${b.P.name} (${b.P.kind}) retreats at 10% HP (state ${b.state})`);

// 4. a retreat is a commitment that ends at a depot: teammates heal there and rejoin the fight
g.titans.splice(0);
const dep = g.world.nearestDepot(g.player.pos);
for (const b of bots) {
  b.scout.hp = b.scout.maxHp * 0.1;
  b.scout.gas = b.scout.maxGas;
  b.scout.spare = 3;
  b.scout.bladeDur = 100;
  b.scout.pos.set(dep.pos.x, 1, dep.pos.z);
}
let frames = 0;
const trail: string[] = [];
while (frames < 60 * 90 && bots.some((b) => b.scout.hp < b.scout.maxHp * 0.9 || b.state === "resupply")) {
  g.titans.splice(0); // a wave may auto-start; keep the depot unlocked for this check
  g.update(dt);
  frames++;
  if (frames % 120 === 0) trail.push(`${(frames / 60).toFixed(0)}s ` + bots.map((b) => `${b.P.kind[0]}:${b.state}:${b.scout.hp.toFixed(0)}@${Math.hypot(b.scout.pos.x - dep.pos.x, b.scout.pos.z - dep.pos.z).toFixed(0)}`).join(" "));
}
if (bots.some((b) => b.scout.hp < b.scout.maxHp * 0.9)) console.log("TRAIL\n" + trail.join("\n"));
for (const b of bots) {
  const ok = b.scout.hp >= b.scout.maxHp * 0.9;
  const d = Math.hypot(b.scout.pos.x - dep.pos.x, b.scout.pos.z - dep.pos.z).toFixed(1);
  check(ok, `${b.P.name} heals at the depot (${b.scout.hp.toFixed(0)}/${b.scout.maxHp} after ${(frames / 60).toFixed(0)} s)${ok ? "" : ` DIAG alive=${b.scout.alive} state=${b.state} dist=${d} radius=${dep.radius} y=${b.scout.pos.y.toFixed(1)} grabbed=${!!b.scout.grabbedBy} titans=${g.titans.length} phase=${(g as any).phase}`}`);
}
check(bots.every((b) => b.state !== "resupply"), "teammates rejoin the fight once restocked");

// 5. a healthy teammate keeps fighting: no retreat at full HP
for (const b of bots) { b.scout.hp = b.scout.maxHp; b.scout.gas = b.scout.maxGas; }
for (let i = 0; i < 40; i++) g.update(dt);
check(bots.every((b) => b.state !== "resupply"), "healthy teammates do not retreat");

console.log(fails === 0 ? "ALL PASSED" : `${fails} FAILED`);
if (fails) process.exitCode = 1;
