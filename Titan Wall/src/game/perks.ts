// Perks and families: a persistent progression layer. Every wave cleared, in any run, counts toward unlocks.
// Pure data and functions: no DOM, no Three.js, so it is testable headless.

export type FamilyId = "ackerman" | "arlert" | "braun";
export type Tier = 1 | 2 | 3;

/** Stat changes a perk makes. Multipliers apply to the base value, additive ones add to it. */
export interface PerkFx {
  maxHp?: number; // added
  maxGas?: number; // multiplier
  maxSpare?: number; // added (blade reloads carried)
  killSpeed?: number; // added (negative is easier)
  maxSpears?: number; // added
  spearRestock?: number; // multiplier on the 6 s restock time
  hookCooldown?: number; // multiplier on the hook cooldown
}

export interface Perk {
  id: string;
  family: FamilyId;
  tier: Tier;
  name: string;
  desc: string;
  fx: PerkFx;
}

export const FAMILIES: { id: FamilyId; name: string; blurb: string }[] = [
  { id: "ackerman", name: "House Ackerman", blurb: "Blades and cutting. Faster nape kills, more blade reloads." },
  { id: "arlert", name: "House Arlert", blurb: "Gas and mobility. Bigger tanks, quicker hooks." },
  { id: "braun", name: "House Braun", blurb: "Endurance and the squad. Tougher bodies, faster spear restocks." },
];

export const PERKS: Perk[] = [
  { id: "ack-1", family: "ackerman", tier: 1, name: "Quick Edge", desc: "Cut at 1 m/s less speed.", fx: { killSpeed: -1 } },
  { id: "ack-2", family: "ackerman", tier: 2, name: "Spare Set", desc: "Carry one more blade reload.", fx: { maxSpare: 1 } },
  { id: "ack-3", family: "ackerman", tier: 3, name: "Nape Hunter", desc: "Cut at 2 m/s less speed.", fx: { killSpeed: -2 } },
  { id: "arl-1", family: "arlert", tier: 1, name: "Deep Tank", desc: "25% more gas.", fx: { maxGas: 1.25 } },
  { id: "arl-2", family: "arlert", tier: 2, name: "Quick Hook", desc: "Hooks are ready 25% sooner.", fx: { hookCooldown: 0.75 } },
  { id: "arl-3", family: "arlert", tier: 3, name: "Thunder Quiver", desc: "Carry one more thunder spear.", fx: { maxSpears: 1 } },
  { id: "bra-1", family: "braun", tier: 1, name: "Iron Frame", desc: "15 more HP.", fx: { maxHp: 15 } },
  { id: "bra-2", family: "braun", tier: 2, name: "Quartermaster", desc: "Spears restock 30% faster.", fx: { spearRestock: 0.7 } },
  { id: "bra-3", family: "braun", tier: 3, name: "Last Stand", desc: "25 more HP and 25% more gas.", fx: { maxHp: 25, maxGas: 1.25 } },
];

/** Total cleared waves (across all runs) needed for each tier to unlock. */
export const TIER_WAVES: Record<Tier, number> = { 1: 10, 2: 25, 3: 45 };
export const MAX_LOADOUT = 3;

export interface Progress {
  totalWaves: number;
  loadout: string[];
}

export const EMPTY_PROGRESS: Progress = { totalWaves: 0, loadout: [] };

export const perkById = (id: string) => PERKS.find((p) => p.id === id);

/** A perk is unlocked once the lifetime wave total reaches its tier's threshold. */
export function isUnlocked(perk: Perk, totalWaves: number): boolean {
  return totalWaves >= TIER_WAVES[perk.tier];
}

export function unlockedPerks(totalWaves: number): Perk[] {
  return PERKS.filter((p) => isUnlocked(p, totalWaves));
}

/** Keeps only unlocked, known, unique perks, capped at MAX_LOADOUT. */
export function sanitizeLoadout(ids: readonly string[], totalWaves: number): string[] {
  const out: string[] = [];
  for (const id of ids) {
    const p = perkById(id);
    if (!p || !isUnlocked(p, totalWaves) || out.includes(id)) continue;
    out.push(id);
    if (out.length >= MAX_LOADOUT) break;
  }
  return out;
}

/** Base player stats, before any perk. */
export interface BaseStats {
  maxHp: number;
  maxGas: number;
  maxSpare: number;
  killSpeed: number;
  maxSpears: number;
  spearRestock: number; // seconds
  hookCooldown: number; // multiplier, 1 = as designed
}

export const BASE_STATS: BaseStats = {
  maxHp: 100,
  maxGas: 100,
  maxSpare: 4,
  killSpeed: 12,
  maxSpears: 3,
  spearRestock: 6,
  hookCooldown: 1,
};

/** The stats a loadout produces. Unknown or locked ids are ignored, so a stale save cannot break a run. */
export function applyLoadout(base: BaseStats, ids: readonly string[], totalWaves: number): BaseStats {
  const s: BaseStats = { ...base };
  for (const id of sanitizeLoadout(ids, totalWaves)) {
    const fx = perkById(id)!.fx;
    if (fx.maxHp) s.maxHp += fx.maxHp;
    if (fx.maxGas) s.maxGas *= fx.maxGas;
    if (fx.maxSpare) s.maxSpare += fx.maxSpare;
    if (fx.killSpeed) s.killSpeed += fx.killSpeed;
    if (fx.maxSpears) s.maxSpears += fx.maxSpears;
    if (fx.spearRestock) s.spearRestock *= fx.spearRestock;
    if (fx.hookCooldown) s.hookCooldown *= fx.hookCooldown;
  }
  s.killSpeed = Math.max(6, s.killSpeed); // a perk can make cutting easier, never trivial
  return s;
}

const KEY = "titanwall.progress.v1";

/** Reads saved progress. Corrupt or missing data falls back to a fresh profile. */
export function loadProgress(storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage): Progress {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return { ...EMPTY_PROGRESS, loadout: [] };
    const v = JSON.parse(raw);
    const totalWaves = Number.isFinite(v?.totalWaves) && v.totalWaves > 0 ? Math.floor(v.totalWaves) : 0;
    const loadout = Array.isArray(v?.loadout) ? v.loadout.filter((x: unknown) => typeof x === "string") : [];
    return { totalWaves, loadout: sanitizeLoadout(loadout, totalWaves) };
  } catch {
    return { ...EMPTY_PROGRESS, loadout: [] };
  }
}

export function saveProgress(p: Progress, storage: Pick<Storage, "setItem"> | undefined = globalThis.localStorage) {
  try {
    storage?.setItem(KEY, JSON.stringify(p));
  } catch {
    /* private mode or full storage: progress just does not persist */
  }
}
