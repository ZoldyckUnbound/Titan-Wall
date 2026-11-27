// Horses: a supply that runs down, faster ground pace while riding, hooks off in the saddle, restock at depots.
import { Game } from "../src/game/game";
import { Scout, RIDE_SPEED_MULT } from "../src/game/scout";
import * as THREE from "three";

let fails = 0;
const check = (ok: boolean, msg: string) => {
  console.log(ok ? "PASS" : "FAIL", msg);
  if (!ok) fails++;
};

const g: any = new Game({ onToast: () => {} });
g.start();
g.titans.splice(0);
const p: Scout = g.player;
for (const b of g.brains) b.scout.alive = false; // isolate the player

check(p.horses === 1, "a run starts with one horse in the supply");
// put the player on open ground, grounded, away from titans
p.reset(new THREE.Vector3(0, 1, 0));
p.grounded = true;
for (let i = 0; i < 30; i++) g.update(1 / 60);

function topSpeed(mounted: boolean) {
  p.reset(new THREE.Vector3(0, 1, 0));
  p.setMounted(mounted);
  p.hooks.forEach((h: any) => (h.state = "idle"));
  let best = 0;
  for (let i = 0; i < 180; i++) {
    p.grounded = true;
    g.keys.add("KeyW");
    g.update(1 / 60);
    best = Math.max(best, Math.hypot(p.vel.x, p.vel.z));
  }
  g.keys.delete("KeyW");
  return best;
}
const walk = topSpeed(false);
const ride = topSpeed(true);
check(ride > walk * 1.8, `riding is much faster on the ground (${ride.toFixed(1)} vs ${walk.toFixed(1)} m/s)`);
check(Math.abs(ride / walk - RIDE_SPEED_MULT) < 0.35, `ride pace is about ${RIDE_SPEED_MULT}x the walk`);

// mounting takes a horse from the supply; you cannot mount twice or with none left
p.reset(new THREE.Vector3(0, 1, 0));
p.setMounted(false);
p.horses = 1;
p.grounded = true;
g.toggleMount();
check(p.mounted && p.horses === 0, "H mounts a horse and takes it from the supply");
g.toggleMount();
check(!p.mounted && p.horses === 0, "H dismounts; the horse is left behind (supply stays empty)");
g.toggleMount();
check(!p.mounted && p.horses === 0, "no horse left, so H does nothing");

// no hooks while riding
p.horses = 1;
p.grounded = true;
g.toggleMount();
p.hooks.forEach((h: any) => (h.state = "idle"));
g.playerCtrl.fire[0] = new THREE.Vector3(0, 0.1, 1).normalize();
g.update(1 / 60);
check(p.hooks[0].state === "idle", "no hook fires while riding");
g.playerCtrl.fire[0] = null;
g.toggleMount(); // dismount

// the horse mesh follows the rider
p.setMounted(true);
check(!!p.horse && p.horse.visible, "the horse model shows while mounted");
p.setMounted(false);
check(!p.horse.visible, "the horse model hides on dismount");
g.toggleMount && p.setMounted(false);

// restock: a depot brings back a horse, up to the cap
p.horses = 0;
const dep = g.world.depots[0];
p.reset(new THREE.Vector3(dep.pos.x, 1, dep.pos.z));
for (const t of g.titans) t.alive = false;
for (let i = 0; i < 60 * 40; i++) {
  p.reset(new THREE.Vector3(dep.pos.x, 1, dep.pos.z));
  g.update(1 / 60);
  if (p.horses > 0) break;
}
check(p.horses >= 1, "a supply depot restocks a horse");

console.log(fails ? `${fails} FAILED` : "ALL PASSED");
process.exit(fails ? 1 : 0);
