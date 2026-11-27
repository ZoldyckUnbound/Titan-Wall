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
function trial(label: string, pos: [number, number, number], vel: [number, number, number], slash = true) {
  T.hp = 100; T.alive = true; (T as any).state = "recover"; (T as any).st = 0; (T as any).recDur = 99;
  p.pos.set(...pos); p.vel.set(...vel); p.bladeDur = 100; p.invuln = 5; p.slashHit = false; p.slashT = 0;
  g.update(dt); // refresh nape
  p.pos.set(...pos); p.vel.set(...vel);
  if (slash) a.pendSlash = true;
  msgs.length = 0;
  for (let i = 0; i < 12; i++) { p.vel.set(...vel); g.update(dt); if (!T.alive) break; }
  console.log(label.padEnd(34), "titanAlive:", T.alive, "hp:", T.hp, "blade:", p.bladeDur.toFixed(0), "|", msgs.join(" / "));
  if (!T.alive) { T.alive = true; }
}
g.update(dt);
const n = T.nape;
console.log("nape at", n.x.toFixed(1), n.y.toFixed(1), n.z.toFixed(1), "h", T.height.toFixed(1), "napeR", T.napeR.toFixed(2));
trial("fast slash at nape from behind", [n.x, n.y, n.z - 3.2], [0, 0, 20]);
trial("slow slash at nape", [n.x, n.y, n.z - 3.2], [0, 0, 3]);
trial("fast slash at nape from FRONT", [n.x, n.y, n.z + 6], [0, 0, -20]);
trial("fast slash at torso (not nape)", [T.spheres[2].c.x + 3.5, T.spheres[2].c.y, T.spheres[2].c.z + 1], [-15, 0, 0]);
trial("no slash, fast pass", [n.x, n.y, n.z - 3.2], [0, 0, 20], false);
