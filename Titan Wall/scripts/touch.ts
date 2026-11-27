// Touch controls drive the same simulation as the keyboard: stick, look drag, boost, hooks, slash.
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
for (const b of g.brains) { b.scout.alive = false; b.scout.model.visible = false; }
g.player.invuln = 99;

// stick forward moves the player forward (camera yaw 0 faces +Z)
g.player.vel.set(0, 0, 0);
const z0 = g.player.pos.z;
g.player.pos.set(0, 30, 0);
const z1 = g.player.pos.z;
g.touch.my = 1;
for (let i = 0; i < 60; i++) g.update(dt);
g.touch.my = 0;
check(g.player.pos.z > z1 + 1, `stick forward moves the player (+${(g.player.pos.z - z1).toFixed(1)} m)`);

// stick right moves the player right (strafe)
g.player.pos.set(0, 30, 0);
g.player.vel.set(0, 0, 0);
const x0 = g.player.pos.x;
g.touch.mx = 1;
for (let i = 0; i < 60; i++) g.update(dt);
g.touch.mx = 0;
check(Math.abs(g.player.pos.x - x0) > 1, `stick sideways strafes (${(g.player.pos.x - x0).toFixed(1)} m)`);

// look drag turns the camera; clamped pitch
const yaw0 = a.camYaw, pitch0 = a.camPitch;
g.touch.lookX = 100;
g.touch.lookY = -100;
g.update(dt);
check(Math.abs(a.camYaw - yaw0) > 0.2, `look drag turns the camera (yaw ${(a.camYaw - yaw0).toFixed(2)} rad)`);
check(a.camPitch > pitch0, "dragging up tilts the camera up");
check(g.touch.lookX === 0 && g.touch.lookY === 0, "look input is consumed each frame");
g.touch.lookY = 10000;
g.update(dt);
check(a.camPitch <= 1.3 + 1e-9 && a.camPitch >= -1.3 - 1e-9, "pitch stays clamped");

// boost button: the boost flag reaches the scout controller
g.touch.boost = true;
g.update(dt);
check(a.playerCtrl.boost === true, "boost button sets the boost control");
g.touch.boost = false;

// hook tap queues a hook; the hook leaves the hand
g.touchAction("hookL");
let shot = false;
for (let i = 0; i < 30 && !shot; i++) { g.update(dt); shot = a.pendFire[0] === 0 && g.player.hooks[0].cooldown > 0; }
check(shot, "hook tap fires the left hook (buffer consumed, cooldown restarted once the hook was ready)");

// slash: a tap queues one slash
g.touchAction("slash");
check(a.pendSlash === true, "slash tap queues a slash");
g.update(dt);
check(a.pendSlash === false, "slash is one-shot");

// actions are ignored outside play
g.pause();
g.touchAction("spear");
check(a.pendSpear === false, "touch actions are ignored while paused");

console.log(fails === 0 ? "ALL PASSED" : `${fails} FAILED`);
if (fails) process.exitCode = 1;
