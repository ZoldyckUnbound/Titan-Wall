// Perks and families: unlock rules, loadout limits, stat math, saved progress, and what reaches the player in a run.
import { PERKS, FAMILIES, TIER_WAVES, MAX_LOADOUT, BASE_STATS, isUnlocked, sanitizeLoadout, applyLoadout, loadProgress, saveProgress, unlockedPerks } from "../src/game/perks";
import { Game } from "../src/game/game";

let fails = 0;
const check = (ok: boolean, label: string) => {
  if (!ok) fails++;
  console.log(ok ? "PASS" : "FAIL", label);
};

// 1. catalogue shape
check(FAMILIES.length === 3, "three families");
check(FAMILIES.every((f) => [1, 2, 3].every((t) => PERKS.some((p) => p.family === f.id && p.tier === t))), "every family has a tier 1, 2 and 3 perk");
check(new Set(PERKS.map((p) => p.id)).size === PERKS.length, "perk ids are unique");

// 2. unlocks by lifetime waves cleared
const perk = (id: string) => PERKS.find((p) => p.id === id)!;
check(!isUnlocked(perk("arl-1"), TIER_WAVES[1] - 1) && isUnlocked(perk("arl-1"), TIER_WAVES[1]), `tier 1 unlocks at ${TIER_WAVES[1]} waves`);
check(!isUnlocked(perk("ack-2"), TIER_WAVES[2] - 1) && isUnlocked(perk("ack-2"), TIER_WAVES[2]), `tier 2 unlocks at ${TIER_WAVES[2]} waves`);
check(unlockedPerks(0).length === 0 && unlockedPerks(999).length === PERKS.length, "no perks at zero waves, all at the top threshold");

// 3. loadouts: locked, unknown and duplicate ids are dropped; the cap is enforced
const all = PERKS.map((p) => p.id);
check(sanitizeLoadout(["arl-1"], 0).length === 0, "a locked perk cannot be equipped");
check(sanitizeLoadout(["nope", "arl-1", "arl-1"], TIER_WAVES[1]).join() === "arl-1", "unknown and duplicate ids are dropped");
check(sanitizeLoadout(all, 999).length === MAX_LOADOUT, `loadout is capped at ${MAX_LOADOUT}`);

// 4. stat math
const q = applyLoadout(BASE_STATS, ["arl-1"], TIER_WAVES[1]);
check(Math.abs(q.maxGas - 125) < 1e-9, `Deep Tank: gas 100 → ${q.maxGas}`);
const h = applyLoadout(BASE_STATS, ["bra-1"], TIER_WAVES[1]);
check(h.maxHp === 115, `Iron Frame: HP 100 → ${h.maxHp}`);
const blade = applyLoadout(BASE_STATS, ["ack-1", "ack-3"], TIER_WAVES[3]);
check(blade.killSpeed === 9, `two blade perks: cut speed 12 → ${blade.killSpeed}`);
check(applyLoadout({ ...BASE_STATS, killSpeed: 7 }, ["ack-1", "ack-3"], 999).killSpeed === 6, "cut speed never drops below 6");
check(Math.abs(applyLoadout(BASE_STATS, ["bra-2"], TIER_WAVES[2]).spearRestock - 4.2) < 1e-9, "Quartermaster: spear restock 6 s → 4.2 s");
check(applyLoadout(BASE_STATS, [], 999).maxGas === 100, "an empty loadout is the base stats");

// 5. saved progress: round trip, corrupt data falls back, stale loadouts are cleaned on load
const mem = new Map<string, string>();
const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
saveProgress({ totalWaves: 30, loadout: ["arl-1", "ack-1"] }, store);
const back = loadProgress(store);
check(back.totalWaves === 30 && back.loadout.join() === "arl-1,ack-1", "progress survives a save and load");
mem.set("titanwall.progress.v1", "{not json");
check(loadProgress(store).totalWaves === 0, "corrupt progress falls back to a fresh profile");
mem.set("titanwall.progress.v1", JSON.stringify({ totalWaves: 5, loadout: ["arl-1", "bra-3"] }));
check(loadProgress(store).loadout.length === 0, "a loadout with locked perks is cleaned on load");

// 6. in a run: the loadout reaches the player, and locked perks do nothing
const g = new Game({ onToast: () => {} });
g.start();
const p = g.player;
g.setLoadout(["arl-1"], 0);
g.start(1);
check(p.maxGas === 100, "a locked perk does not change the run");
g.setLoadout(["arl-1", "bra-1"], TIER_WAVES[1]);
g.start(1);
check(Math.abs(p.maxGas - 125) < 1e-9 && p.maxHp === 115, `the loadout reaches the run (gas ${p.maxGas}, HP ${p.maxHp})`);
check(p.gas === p.maxGas && p.hp === p.maxHp, "a run starts with full, perk-adjusted gas and HP");
g.setLoadout(["arl-2"], TIER_WAVES[2]);
g.start(1);
check(Math.abs(p.cooldownMult - 0.75) < 1e-9, "Quick Hook shortens the hook cooldown");

// 7. clearing a wave reports it (the menu's lifetime total counts these)
{
  const cleared: number[] = [];
  const g2 = new Game({ onToast: () => {}, onWaveCleared: (w: number) => cleared.push(w) });
  g2.start(1);
  g2.titans.splice(0);
  g2.update(1 / 60);
  check(cleared.length === 1 && cleared[0] === 1, "clearing wave 1 reports it once");
}

console.log(fails === 0 ? "ALL PASSED" : `${fails} FAILED`);
if (fails) process.exitCode = 1;
