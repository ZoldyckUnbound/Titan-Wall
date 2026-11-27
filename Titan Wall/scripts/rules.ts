/* Economy rules test. Usage: npx tsx scripts/rules.ts
 *  - healing only ticks above 75 HP, and it is slow,
 *  - a depot gives nothing while a titan is too close, and works again once the titan is gone. */
import { Game } from "../src/game/game";
import { Titan } from "../src/game/titan";
import { Vector3 as V } from "three";

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
const _unused = 0; void _unused;
const t = new Titan(12, false, new (await import("three")).Vector3(dep.pos.x + 10, 0, dep.pos.z));
g.titans.push(t);
g.scene.add(t.model);
for (let i = 0; i < 120; i++) { p.pos.set(dep.pos.x, 1, dep.pos.z); t.pos.set(dep.pos.x + 10, 0, dep.pos.z); t.state = "recover"; (t as any).recDur = 99; g.update(1 / 60); }
check(p.gas < openGas, `depot locked while a titan is close (gas ${p.gas.toFixed(1)})`);
check(p.spare === 0, "no blade resupply while locked");
// 4. grab rules: no grab while another titan is in arm's reach, and none right after a release
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
// 5. retry / resume: start(fromWave) begins at that wave and clamps the input
const g2 = new Game({ onToast: () => {} });
g2.start(10);
check(g2.wave === 10 && g2.titans.some((t) => t.kind === "colossal"), "start(10) resumes at wave 10 with the colossal");
g2.start(0);
check(g2.wave === 1, "start(0) clamps to wave 1");
g2.start(999);
check(g2.wave === 60, "start(999) clamps to the final wave 60");
// 6. hitboxes: limb volumes follow the animated rig, and scouts are pushed off them
const g3 = new Game({ onToast: () => {} });
g3.start();
const T3 = new Titan(12, false, new V(-6000, 0, -6000));
g3.titans.splice(0);
g3.titans.push(T3);
g3.scene.add(T3.model);
T3.state = "recover";
(T3 as any).recDur = 99;
for (let i = 0; i < 30; i++) { T3.update(1 / 60, g3 as any); }
const elbow = (T3.parts as any).elbowL as import("three").Object3D;
const ep = new V(); elbow.getWorldPosition(ep);
const limb = T3.spheres.find((x) => x.kind === "arm")!;
check(limb.c.distanceTo(ep) < 1e-3, "elbow hit volume sits on the elbow joint");
const knee = (T3.parts as any).kneeR as import("three").Object3D;
const kp = new V(); knee.getWorldPosition(kp);
const kn = T3.spheres[5 + 3]; // right knee (limb volumes follow elbowL, elbowR, kneeL, kneeR)
check(kn.c.distanceTo(kp) < 1e-3 && kn.r > 0, "knee hit volume sits on the knee joint");
const sc3 = g3.player;
g3.brains.forEach((b) => (b.scout.alive = false));
sc3.invuln = 99;
sc3.pos.set(kp.x, kp.y, kp.z);
sc3.vel.set(0, 0, 0);
g3.update(1 / 60);
const dk = sc3.pos.distanceTo(kn.c);
check(dk >= kn.r, `scout pushed off a knee volume (distance ${dk.toFixed(2)} >= radius ${kn.r.toFixed(2)})`);
// 7. thunder spears: a hit pins and damages a titan; ammo is limited and restocked at depots
const g4 = new Game({ onToast: () => {} });
g4.start();
g4.titans.splice(0);
g4.brains.forEach((b) => (b.scout.alive = false));
const T4 = new Titan(12, false, new V(-6000, 0, -6000));
g4.titans.push(T4);
g4.scene.add(T4.model);
T4.state = "recover";
(T4 as any).recDur = 99;
const p4 = g4.player;
p4.invuln = 99;
p4.spears = 1;
p4.pos.set(-6000, 6, -6030);
g4.camYaw = 0;
g4.camPitch = 0;
const hp0 = T4.hp;
(g4 as any).pendSpear = true;
g4.update(1 / 60);
check(p4.spears === 0, "throwing uses one spear");
check(T4.state === "stunned" && T4.hp < hp0, `spear pins the titan and hurts it (hp ${hp0} -> ${T4.hp.toFixed(0)})`);
(g4 as any).pendSpear = true;
g4.update(1 / 60);
check(p4.spears === 0, "no spear thrown with none left");
const dep4 = g4.world.depots[0];
p4.spears = 0;
(g4 as any).spearT = 0;
p4.pos.set(dep4.pos.x, 1, dep4.pos.z);
for (let i = 0; i < 60 * 7; i++) { p4.pos.set(dep4.pos.x, 1, dep4.pos.z); g4.update(1 / 60); }
check(p4.spears >= 1, `depot restocks a thunder spear (now ${p4.spears})`);
// 8. ending: impact cards reflect the run (no DOM needed)
const { impactCards } = await import("../src/Ending");
const mate = (alive: boolean) => ({ id: "x", name: "n", title: "t", color: "#fff", hp: 1, maxHp: 1, gas: 1, alive, label: "", kills: 0, alert: false });
const squadAll = [mate(true), mate(true), mate(true)];
const squadNone = [mate(false), mate(false)];
const base = { wave: 60, kills: 90, score: 9000, squad: squadAll };
const titles = (st: any) => impactCards(st).map((c) => c.title);
check(titles({ ...base, napeKills: 50 }).includes("The nape cut"), "many nape cuts earn the 'nape cut' card");
check(titles({ ...base, napeKills: 2 }).includes("A few clean cuts"), "few nape cuts earn the modest card");
check(titles({ ...base, napeKills: 5 }).includes("Nobody left behind"), "a full squad is credited");
check(titles({ ...base, napeKills: 5, squad: squadNone }).includes("The cost"), "a lost squad is acknowledged");
check(impactCards({ ...base, napeKills: 5 }).length === 4, "four impact cards per ending");
// 9. music: every wave has its own theme, and the seasons line up with the waves
const { trackPlan } = await import("../src/game/music");
const key = (n: number) => { const p = trackPlan(n); return `${p.rootHz}|${p.bpm}|${p.arp.join("")}|${p.bass.join("")}`; };
let sameAsNext = 0;
for (let n = 1; n < 60; n++) if (key(n) === key(n + 1)) sameAsNext++;
check(sameAsNext === 0, `no two consecutive waves share a theme (${sameAsNext} clashes)`);
const distinct = new Set(Array.from({ length: 60 }, (_, i) => key(i + 1))).size;
check(distinct >= 45, `the 60 waves use many different themes (${distinct} distinct)`);
check(trackPlan(1).season === "maria" && trackPlan(10).season === "breach" && trackPlan(20).season === "beast" && trackPlan(40).season === "chapter" && trackPlan(60).season === "finale", "seasons map to waves 1 / 10 / 20 / 40 / 60");
check(Array.from({ length: 60 }, (_, i) => trackPlan(i + 1).bpm).every((b) => b >= 84 && b <= 150), "tempos stay in the 84–150 BPM range");
check(trackPlan(0).wave === 1 && trackPlan(999).wave === 60, "track plans clamp out-of-range waves");
// 10. music scheduler runs against a stub AudioContext (the real one needs a browser)
{
  const made = { osc: 0, buf: 0, gain: 0 };
  const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {} });
  const node = () => ({ connect() { return this; }, start() {}, stop() {}, frequency: param(), detune: param(), Q: param(), gain: param(), type: "", buffer: null, loop: false });
  const ctxStub: any = {
    currentTime: 0,
    sampleRate: 8000,
    createOscillator: () => (made.osc++, node()),
    createGain: () => (made.gain++, node()),
    createBiquadFilter: () => node(),
    createBufferSource: () => node(),
    createBuffer: (_c: number, len: number) => (made.buf++, { getChannelData: () => new Float32Array(len) }),
    destination: {},
  };
  (globalThis as any).window = { setInterval: () => 1, clearInterval() {} };
  const { Music } = await import("../src/game/music");
  const m: any = new Music();
  m.attach(ctxStub, {});
  for (const w of [1, 10, 20, 60]) {
    m.setIntensity(1);
    m.play(w);
    for (let k = 0; k < 40; k++) { ctxStub.currentTime += 0.05; m.pump(); }
  }
  check(made.osc > 40, `music schedules voices on the stub context (${made.osc} oscillators)`);
  m.stop();
  delete (globalThis as any).window;
}
console.log(fails ? `${fails} FAILED` : "ALL PASSED");
process.exit(fails ? 1 : 0);
