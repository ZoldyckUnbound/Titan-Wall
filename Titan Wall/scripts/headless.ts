/* Headless smoke test: runs the full simulation (no WebGL) and prints squad/titan stats. */
import { Game } from "../src/game/game";

const SECONDS = Number(process.env.SECS ?? 120);
const barks: string[] = [];
const toasts: string[] = [];
const g = new Game({
  onBark: (b) => barks.push(`[${b.who}] ${b.text}`),
  onToast: (t) => toasts.push(t.text),
});
g.start();
const anyG = g as unknown as { keys: Set<string>; mouse: boolean[]; camYaw: number; playerCtrl: unknown };

let nan = false;
const dt = 1 / 60;
const fmt = (n: number) => n.toFixed(1);
const stats = { crashes: 0, maxSpeed: 0 };

const mode = process.env.PLAYER ?? "script";
const playerScript = mode === "script";
for (let i = 0; i < SECONDS * 60; i++) {
  const t = i * dt;
  if (playerScript) {
    // simple scripted player: hold W, alternate hooks, boost in bursts
    anyG.keys.add("KeyW");
    anyG.mouse[0] = Math.floor(t / 2) % 2 === 0;
    anyG.mouse[1] = Math.floor(t / 2) % 2 === 1;
    if (i % 90 === 0) (g as unknown as { pendFire: number[] }).pendFire = [0.2, 0.2];
    if (Math.floor(t) % 6 < 2) anyG.keys.add("Space");
    else anyG.keys.delete("Space");
    anyG.camYaw += 0.004;
  }
  if (mode === "sky") {
    g.player.pos.set(0, 100, -100);
    g.player.vel.set(0, 0, 0);
  }
  g.update(dt);
  for (const s of g.scouts) {
    if (![s.pos.x, s.pos.y, s.pos.z, s.vel.x, s.vel.y, s.vel.z].every(Number.isFinite)) {
      nan = true;
      console.log("NaN in", s.name, s.pos, s.vel);
    }
    stats.maxSpeed = Math.max(stats.maxSpeed, s.speed);
  }
  for (const ti of g.titans) {
    if (![ti.pos.x, ti.pos.y, ti.pos.z, ti.yaw].every(Number.isFinite)) {
      nan = true;
      console.log("NaN in titan", ti.id);
    }
  }
  if (!process.env.QUIET && i % (60 * 10) === 0) {
    console.log(`\n--- t=${fmt(t)}s wave ${g.wave} titans alive ${g.titans.filter((x) => x.alive).length}/${g.titans.length} kills ${g.kills} phase ${g.phase}`);
    for (const b of g.brains) {
      const s = b.scout;
      console.log(
        `${s.name.padEnd(7)} ${b.state.padEnd(9)} hp ${fmt(s.hp).padStart(5)} gas ${fmt(s.gas).padStart(5)} blade ${fmt(s.bladeDur).padStart(5)}/${s.spare} pos (${fmt(s.pos.x)},${fmt(s.pos.y)},${fmt(s.pos.z)}) spd ${fmt(s.speed)} kills ${s.kills}${s.grabbedBy ? " GRABBED" : ""}${s.alive ? "" : " DEAD"}`
      );
    }
    const p = g.player;
    console.log(`PLAYER  hp ${fmt(p.hp)} gas ${fmt(p.gas)} pos (${fmt(p.pos.x)},${fmt(p.pos.y)},${fmt(p.pos.z)}) spd ${fmt(p.speed)} hooks ${p.hooks[0].state}/${p.hooks[1].state}`);
    for (const ti of g.titans.filter((x) => x.alive)) console.log(`  titan#${ti.id} ${ti.abnormal ? "ABN" : "   "} ${fmt(ti.height)}m ${ti.state.padEnd(11)} tgt=${ti.target?.name ?? "-"} (${fmt(ti.pos.x)},${fmt(ti.pos.z)})`);
  }
  if (g.phase === "dead") {
    console.log("\nPLAYER DIED at", fmt(t), g.deathCause);
    break;
  }
}
console.log("\nNaN:", nan, "maxSpeed:", fmt(stats.maxSpeed), "kills:", g.kills, "wave:", g.wave, "score:", g.score);
console.log("squad kills:", g.brains.map((b) => `${b.scout.name}=${b.scout.kills}`).join(" "), "player", g.player.kills);
if (!process.env.QUIET) {
  console.log("\nTOASTS:\n" + toasts.slice(0, 40).join("\n"));
  console.log("\nBARKS:\n" + barks.slice(0, 40).join("\n"));
}
console.log("KIA:", toasts.filter((t) => t.includes("KIA")).join(" | "), "| grabs:", toasts.filter((t) => t.includes("grabbed")).length);
