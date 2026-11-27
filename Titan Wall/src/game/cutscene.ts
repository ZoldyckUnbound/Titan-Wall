/**
 * The title card shown before every wave. Pure text, so it can be tested without the renderer.
 * Lines follow the anime's story beats: the Garrison's first fights in Maria, the wave-10 breach at
 * Shiganshina, the beast titans, Rod Reiss, and the final stand against the Founding Titan.
 */
import type { WaveSpec } from "./waves";
import { FINAL_WAVE, KICK_WAVE, BEAST_WAVE, REISS_WAVE } from "./waves";

export interface IntroCard {
  /** e.g. "WAVE 10" */
  kicker: string;
  title: string;
  body: string;
  /** a short line of what is coming, built from the spawn list */
  forecast: string;
}

export const INTRO_SECONDS = 7;

function storyLine(n: number): string {
  if (n === 1) return "Wall Maria has held for a century. Today the first titans of the year are walking across the farmland. Find the nape.";
  if (n === KICK_WAVE) return "A colossal titan is walking toward Shiganshina. When it kicks the gate, the wall falls and everything behind it is exposed.";
  if (n > KICK_WAVE && n < BEAST_WAVE) return "The breach is open. Titans pour through the gap in Wall Maria. Hold the road to the inner districts.";
  if (n === BEAST_WAVE) return "Beast titans throw stones from the forest canopy. Watch the sky, and do not let the stones pin you to the ground.";
  if (n === REISS_WAVE) return "Rod Reiss crawls out of the mist on all fours. Its face is not a face, and its only weak point is the nape.";
  if (n >= 40 && n < FINAL_WAVE) return "Beyond the walls the Survey Corps has learned what the titans want. Every wave brings them closer to the truth.";
  if (n === FINAL_WAVE) return "The Founding Titan walks. Everything that began at Wall Maria ends here. Clear this wave and the walls can finally be freed.";
  if (n >= 15) return "Armored titans have grown plates over the nape. Cut the gap at speed, or the blade will only scrape them.";
  return "Titans are walking the fields of Wall Maria. Swing between the rooftops and keep your squad alive.";
}

export function introFor(spec: WaveSpec): IntroCard {
  const counts = new Map<string, number>();
  for (const s of spec.spawns) counts.set(s.kind, (counts.get(s.kind) ?? 0) + 1);
  const label: Record<string, string> = {
    normal: "titans",
    abnormal: "abnormal",
    armored: "armored",
    colossal: "colossal",
    beast: "beast",
    reiss: "Rod Reiss",
    hammer: "war hammer",
    founding: "Founding Titan",
  };
  const parts = [...counts.entries()].map(([k, v]) => `${v} ${label[k] ?? k}`);
  const forecast = parts.length ? parts.join(" · ") : "no titans";
  return {
    kicker: `WAVE ${spec.n} OF ${FINAL_WAVE}`,
    title: spec.title.toUpperCase(),
    body: storyLine(spec.n),
    forecast,
  };
}
