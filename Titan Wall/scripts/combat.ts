import { Game } from "../src/game/game";
const msgs: string[] = [];
const OPEN_X = Number(process.env.OPEN_X ?? 9000), OPEN_Z = Number(process.env.OPEN_Z ?? 0);
const g = new Game({ onToast: (t) => msgs.push(t.text) });
g.start();
const a = g as any;
const p = g.player;
const T = g.titans[0];
// Open ground well clear of any building (the map is now lore-scaled; the origin is the Mitras palace).
T.pos.set(OPEN_X, 0, OPEN_Z); T.yaw = 0; // faces +Z, nape is behind (-Z)
g.titans.splice(1);
(T as any).state = "recover"; (T as any).recDur = 99; // keep it still
for (const b of g.brains) { b.scout.alive = false; b.scout.model.visible = false; }
const dt = 1 / 60;
let fails = 0;
function trial(label: string, pos: [number, number, number], vel: [number, number, number], expectKill: boolean, slash = true) {
  T.hp = 100; T.alive = true; (T as any).state = "recover"; (T as any).st = 0; (T as any).recDur = 99;
  p.pos.set(...pos); p.vel.set(...vel); p.bladeDur = 100; p.invuln = 5; p.slashHit = false; p.slashT = 0;
  g.update(dt); // refresh nape
  p.pos.set(...pos); p.vel.set(...vel);
  if (slash) a.pendSlash = true;
  msgs.length = 0;
  for (let i = 0; i < 12; i++) { p.vel.set(...vel); g.update(dt); if (!T.alive) break; }
  const killed = !T.alive;
  const ok = killed === expectKill;
  if (!ok) fails++;
  console.log(ok ? "PASS" : "FAIL", label.padEnd(34), "titanAlive:", T.alive, "hp:", T.hp, "blade:", p.bladeDur.toFixed(0), "|", msgs.join(" / "));
  if (!T.alive) { T.alive = true; }
}
g.update(dt);
const n = T.nape;
console.log("nape at", n.x.toFixed(1), n.y.toFixed(1), n.z.toFixed(1), "h", T.height.toFixed(1), "napeR", T.napeR.toFixed(2));
// Rule: the nape is only reachable from the back of the titan (game.ts resolveSlash, face-side check).
trial("fast slash at nape from behind", [n.x, n.y, n.z - 3.2], [0, 0, 20], true);
trial("slow slash at nape", [n.x, n.y, n.z - 3.2], [0, 0, 3], false);
trial("fast slash at nape from FRONT", [n.x, n.y, n.z + 6], [0, 0, -20], false); // face side: no nape reach
// Torso: start well outside nape reach so only the body spheres can register.
const tc = T.spheres[2].c;
const torsoStart: [number, number, number] = [tc.x + 3.5, tc.y, tc.z + 1];
const dTorsoNape = Math.hypot(torsoStart[0] - n.x, torsoStart[1] - n.y, torsoStart[2] - n.z);
if (dTorsoNape <= 3 + T.napeR) { fails++; console.log("FAIL torso start sits inside nape reach", dTorsoNape.toFixed(2)); }
trial("fast slash at torso (not nape)", torsoStart, [-15, 0, 0], false);
trial("no slash, fast pass", [n.x, n.y, n.z - 3.2], [0, 0, 20], false, false);
console.log(fails === 0 ? "ALL PASSED" : `${fails} FAILED`);
if (fails) process.exitCode = 1;
