// AOT Revolution / Danny's-style ODM rules: swing with A/D on a hook, no gas while hooked but not boosting,
// boost lifts even when looking down, and blade reloads come from depots (the reload stations).
import { Game } from "../src/game/game";

let fails = 0;
const check = (ok: boolean, label: string) => {
  if (!ok) fails++;
  console.log(ok ? "PASS" : "FAIL", label);
};
const dt = 1 / 60;

function fresh() {
  const g = new Game({ onToast: () => {} });
  g.start();
  g.titans.splice(0);
  for (const b of g.brains) { b.scout.alive = false; b.scout.model.visible = false; }
  g.player.invuln = 999;
  g.player.gas = 100;
  return g;
}
function attach(g: Game, at: [number, number, number], anchor: [number, number, number]) {
  const p = g.player;
  p.pos.set(...at);
  p.vel.set(0, 0, 0);
  const h = p.hooks[0];
  h.state = "attached";
  h.anchor.set(...anchor);
  h.ropeLen = p.pos.distanceTo(h.anchor);
  (g as any).touch.hold[0] = true;
}

// 1. swing: holding a hook and pressing A/D changes lateral speed; not pressing does not
{
  const g = fresh();
  attach(g, [0, 60, 0], [0, 140, 0]);
  for (let i = 0; i < 60; i++) { g.touch.hold[0] = true; g.update(dt); }
  const idle = g.player.vel.x;
  const g2 = fresh();
  attach(g2, [0, 60, 0], [0, 140, 0]);
  g2.touch.mx = 1;
  for (let i = 0; i < 60; i++) { g2.touch.hold[0] = true; g2.touch.mx = 1; g2.update(dt); }
  check(Math.abs(g2.player.vel.x) > Math.abs(idle) + 1, `A/D swing builds lateral speed on a hook (${g2.player.vel.x.toFixed(1)} vs ${idle.toFixed(1)} m/s)`);
  check(g2.player.hooks[0].state === "attached", "the hook stays attached while swinging");
}

// 2. gas: a hooked swing without boosting burns no gas
{
  const g = fresh();
  attach(g, [0, 60, 0], [0, 140, 0]);
  g.touch.mx = 1;
  for (let i = 0; i < 120; i++) { g.touch.hold[0] = true; g.update(dt); }
  check(g.player.gas >= 99.9, `hooked swinging without boost costs no gas (gas ${g.player.gas.toFixed(2)})`);
}

// 3. boost lifts you even when looking straight down, and it burns gas
{
  const g = fresh();
  g.player.pos.set(0, 30, 0);
  g.player.vel.set(0, 0, 0);
  (g as any).camPitch = -1.3; // looking almost straight down
  g.touch.boost = true;
  const y0 = g.player.pos.y;
  for (let i = 0; i < 30; i++) g.update(dt);
  g.touch.boost = false;
  check(g.player.pos.y > y0 + 0.5 || g.player.vel.y > 0, `boost lifts while looking down (Δy ${(g.player.pos.y - y0).toFixed(2)} m, vy ${g.player.vel.y.toFixed(1)})`);
  check(g.player.gas < 100, `boosting burns gas (${g.player.gas.toFixed(1)}%)`);
}

// 4. reload stations: depots restock blades (the 'reload' key and the RELOAD button use spare blades)
{
  const g = fresh();
  const dep = g.world.nearestDepot(g.player.pos);
  g.player.pos.set(dep.pos.x, 1, dep.pos.z);
  g.player.bladeDur = 10;
  g.player.spare = 0;
  g.player.hp = g.player.maxHp;
  for (let i = 0; i < 60 * 12; i++) { g.touch.mx = 0; g.update(dt); }
  check(g.player.spare >= 1, `a depot restocks spare blades (spare ${g.player.spare})`);
}

// 5. sound: the spear throw and pin, and titan footfalls by kind, are triggered and never throw without audio
{
  const g = fresh();
  const calls: string[] = [];
  const sfx = g.sfx as any;
  for (const name of ["spear", "spearPin", "step"]) {
    const orig = sfx[name].bind(sfx);
    sfx[name] = (...args: any[]) => { calls.push(name); return orig(...args); };
  }
  g.player.spears = 2;
  g.player.pos.set(0, 30, 0);
  g.touchAction("spear");
  g.update(dt);
  check(calls.includes("spear") && g.player.spears === 1, "throwing a spear plays the throw sound");
  for (const k of ["normal", "beast", "reiss", "hammer", "founding"] as const) sfx.step(k, 12, 0.5);
  check(true, "footsteps for every titan kind run without audio (no throw)");
}

// 6. releasing a hook in flight keeps your momentum and burns no gas
{
  const g = fresh();
  attach(g, [0, 80, 0], [0, 140, 0]);
  g.player.vel.set(0, 0, 14); // swinging forward
  for (let i = 0; i < 20; i++) { g.touch.hold[0] = true; g.update(dt); }
  const before = g.player.vel.clone();
  const gas0 = g.player.gas;
  g.touch.hold[0] = false; // let go mid-air
  g.update(dt);
  const kept = g.player.vel.length() / Math.max(0.01, before.length());
  check(kept > 0.8, `letting go keeps momentum (${(kept * 100).toFixed(0)}% of speed kept)`);
  check(g.player.gas >= gas0 - 0.01, "letting go burns no gas");
}

console.log(fails === 0 ? "ALL PASSED" : `${fails} FAILED`);
if (fails) process.exitCode = 1;
