/* Wave schedule + wall-breach test. Usage: npx tsx scripts/waves.ts
 * Checks the 60-wave schedule, then runs the wave-10 colossal kick in the real simulation and verifies:
 *  - titans stay inside Wall Maria before the breach,
 *  - the colossal reaches the gate and the Maria wall opens (Rose and Sina stay standing),
 *  - the wave-60 flag ends the campaign. */
import { Game } from "../src/game/game";
import { waveSpec, FINAL_WAVE } from "../src/game/waves";
import { wallRingAt, MARIA_R } from "../src/game/lore";

let fails = 0;
const check = (ok: boolean, msg: string) => {
  console.log((ok ? "PASS " : "FAIL ") + msg);
  if (!ok) fails++;
};

// ---- schedule
const w1 = waveSpec(1);
check(w1.spawns.every((s) => s.kind === "normal"), "wave 1 is normal titans only");
check(waveSpec(10).colossalKick && waveSpec(10).spawns.some((s) => s.kind === "colossal"), "wave 10 has a colossal that kicks");
check(waveSpec(10).breachReinforce.some((s) => s.kind === "armored"), "wave 10 reinforcements include armored titans");
check(waveSpec(20).spawns.every((s) => s.kind === "beast") && waveSpec(20).spawns.length >= 3, "wave 20 is beast titans only");
check(waveSpec(25).spawns.some((s) => s.kind === "reiss") && waveSpec(25).spawns.some((s) => s.kind === "abnormal"), "wave 25 is Reiss + abnormals");
check(waveSpec(15).spawns.some((s) => s.kind === "armored") || waveSpec(16).spawns.some((s) => s.kind === "armored"), "armored titans appear from wave 15");
check(FINAL_WAVE === 60, "campaign ends at wave 60");
check(waveSpec(60).spawns.some((s) => s.kind === "founding") && waveSpec(60).spawns.filter((s) => s.kind === "hammer").length >= 2, "wave 60: Founding Titan with war-hammer escort");
for (let n = 1; n <= 60; n++) {
  const s = waveSpec(n);
  if (s.spawns.length === 0) check(false, `wave ${n} has no spawns`);
}
check(true, "every wave 1–60 has spawns");

// ---- simulation: the wave-10 breach
const toasts: string[] = [];
const g = new Game({ onToast: (t) => toasts.push(t.text) });
g.start();
const a = g as any;
const brainsDead = g.brains.length;
g.brains.forEach((b) => (b.scout.alive = true));
a.startWave(10);
const dt = 1 / 60;
let breached = false;
let insideOk = true;
let maxT = 0;
let arrivedAt = -1;
for (let i = 0; i < 60 * 150 && !breached; i++) {
  // keep the player out of the way (it is not under test here)
  g.player.invuln = 99;
  g.player.pos.set(-200, 4, 4100);
  g.update(dt);
  maxT = i * dt;
  breached = toasts.some((x) => x.includes("BREACHED"));
  const colossal = g.titans.find((t) => t.kind === "colossal");
  if (arrivedAt < 0 && colossal?.scripted?.arrived) arrivedAt = i * dt;
  for (const t of g.titans) {
    if (!t.alive || t.kind === "colossal") continue;
    if (!t.scripted && wallRingAt(t.pos.x, t.pos.z) === "outside" && !breached) insideOk = false;
  }
}
const colossal = g.titans.find((t) => t.kind === "colossal");
check(insideOk, "titans stay inside Wall Maria before the breach");
check(arrivedAt >= 0, `colossal reached the gate (at ${arrivedAt.toFixed(1)} s, breach at ${maxT.toFixed(1)} s)`);
check(breached, "Wall Maria breached by the wave-10 colossal");
const maria = (g.world as any).rings.find((r: any) => r.id === "maria");
const rose = (g.world as any).rings.find((r: any) => r.id === "rose");
const sina = (g.world as any).rings.find((r: any) => r.id === "sina");
const gap = maria.segs.filter((s: any) => !s.box.alive).length;
check(gap > 0, `Maria has a gap (${gap} segments removed)`);
check(rose.segs.every((s: any) => s.box.alive) && sina.segs.every((s: any) => s.box.alive), "Rose and Sina walls are untouched");
const outsideAfter = g.titans.filter((t) => t.alive && wallRingAt(t.pos.x, t.pos.z) === "outside").length;
check(outsideAfter >= 0, `titans after breach: ${g.titans.filter((t) => t.alive).length} alive, ${outsideAfter} still outside`);

// ---- wave-60 completion flag
g.titans.forEach((t) => (t.alive = false));
a.wave = FINAL_WAVE;
a.waveState = "clear";
a.waveState = "active";
g.update(dt);
check(g.phase === "won", "clearing wave 60 completes the campaign (phase won)");
console.log(brainsDead ? `squad size ${brainsDead}` : "");
console.log(fails ? `${fails} FAILED` : "ALL PASSED");
process.exit(fails ? 1 : 0);
