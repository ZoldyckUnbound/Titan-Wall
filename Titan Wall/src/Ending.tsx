import { useEffect, useMemo, useState } from "react";
import type { SquadStat } from "./game/game";

export interface EndingStats {
  wave: number;
  napeKills: number;
  kills: number;
  score: number;
  squad: SquadStat[];
}

const BADGE_KEY = "titanwall.badges";
export const BADGE_VETERAN = "Veteran of the Walls";

/** Badges persist per browser. Returns the badge list after adding `badge`. */
export function awardBadge(badge: string): string[] {
  let list: string[] = [];
  try {
    list = JSON.parse(localStorage.getItem(BADGE_KEY) ?? "[]");
    if (!Array.isArray(list)) list = [];
  } catch {
    list = [];
  }
  if (!list.includes(badge)) list.push(badge);
  try {
    localStorage.setItem(BADGE_KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable: the badge is shown but not kept */
  }
  return list;
}

/** Story cards built from what the player actually did. Every card is true for any completed run. */
export function impactCards(st: EndingStats): { title: string; body: string }[] {
  const alive = st.squad.filter((m) => m.alive).length;
  const total = st.squad.length;
  const cards: { title: string; body: string }[] = [];
  cards.push({
    title: "Wall Maria held",
    body: `Sixty waves. The gate at Shiganshina was breached at wave 10, and the Scout Regiment pushed the Titans back out of the district every time they came in.`,
  });
  cards.push({
    title: st.napeKills >= 40 ? "The nape cut" : st.napeKills >= 10 ? "Blades that found the nape" : "A few clean cuts",
    body:
      st.napeKills >= 40
        ? `${st.napeKills} Titans went down to a clean cut at the nape. Recruits in the training yard are learning the same angle now.`
        : `${st.napeKills} clean nape cuts. Each one bought the city a little more time.`,
  });
  cards.push({
    title: alive === total ? "Nobody left behind" : alive > 0 ? "Who came home" : "The cost",
    body:
      alive === total
        ? `Every squad member made it back to the walls. The regiment remembers that.`
        : alive > 0
          ? `${alive} of ${total} squadmates came home. Their names are on the memorial wall in District 3.`
          : `None of the squad came home. The regiment carries their names on the memorial wall.`,
  });
  cards.push({
    title: "The Founding Titan",
    body: `The last stand ended with the Founding Titan on the ground. What it knew of the world beyond the walls is still unknown — but the walls are still standing.`,
  });
  return cards;
}

const CREDITS = [
  "TITAN WALL",
  "",
  "A fan-made, non-commercial tribute",
  "to Attack on Titan",
  "by Hajime Isayama, Wit Studio and MAPPA.",
  "",
  "Design, code and level layout",
  "Titan Wall team",
  "",
  "Lore references",
  "Wall radii and districts from the series",
  "as summarised on public fan wikis.",
  "",
  "Music and sound",
  "Synthesised in-browser (see the audio notes)",
  "",
  "Thank you for holding the wall.",
  "",
  "TO BE CONTINUED",
  "Titan Wall II — beyond the walls",
];

export function Ending({
  stats,
  onMenu,
  onPlayAgain,
}: {
  stats: EndingStats;
  onMenu: () => void;
  onPlayAgain: () => void;
}) {
  const cards = useMemo(() => impactCards(stats), [stats]);
  const badges = useMemo(() => awardBadge(BADGE_VETERAN), []);
  // step 0 = title card, 1..n = impact cards, n+1 = reward + tease, n+2 = credits
  const last = cards.length + 2;
  const [step, setStep] = useState(0);
  const next = () => setStep((s) => Math.min(last, s + 1));

  // auto-advance the story cards; credits wait for the player
  useEffect(() => {
    if (step >= last) return;
    const t = window.setTimeout(next, step === 0 ? 3200 : 5200);
    return () => window.clearTimeout(t);
  }, [step, last]);

  const panel = "w-[34rem] max-w-[92vw] rounded-xl border border-amber-200/25 bg-black/85 p-8 text-center shadow-2xl";
  return (
    <div className="absolute inset-0 z-40 flex cursor-pointer items-center justify-center bg-black" onClick={next}>
      {step === 0 && (
        <div className={panel}>
          <div className="text-xs tracking-[0.5em] text-amber-200/70">EPILOGUE</div>
          <div className="mt-3 font-serif text-4xl font-black tracking-wider text-white">Sixty Waves</div>
          <div className="mt-2 text-sm text-slate-300">The wall still stands.</div>
        </div>
      )}
      {step >= 1 && step <= cards.length && (
        <div className={panel} key={step}>
          <div className="text-[10px] tracking-[0.4em] text-amber-200/70">
            {step} / {cards.length}
          </div>
          <div className="mt-3 font-serif text-3xl font-bold text-white">{cards[step - 1].title}</div>
          <p className="mt-4 text-sm leading-relaxed text-slate-200">{cards[step - 1].body}</p>
        </div>
      )}
      {step === cards.length + 1 && (
        <div className={panel}>
          <div className="text-xs tracking-[0.4em] text-amber-200/70">REWARD</div>
          <div className="mt-3 font-serif text-3xl font-bold text-amber-300">{BADGE_VETERAN}</div>
          <p className="mt-2 text-sm text-slate-300">
            Wave {stats.wave} · {stats.napeKills} nape cuts · score {stats.score.toLocaleString()}
          </p>
          <div className="mt-3 flex flex-wrap justify-center gap-2 text-[11px] text-slate-400">
            {badges.map((b) => (
              <span key={b} className="rounded border border-amber-300/40 px-2 py-0.5 text-amber-200">
                {b}
              </span>
            ))}
          </div>
          <p className="mt-6 text-sm italic text-slate-300">Beyond the walls, something is waiting. Titan Wall II is coming.</p>
          <div className="mt-6 flex justify-center gap-3" onClick={(e) => e.stopPropagation()}>
            <button onClick={onPlayAgain} className="rounded bg-amber-400 px-6 py-2 text-sm font-extrabold tracking-widest text-black hover:bg-amber-300">
              PLAY AGAIN
            </button>
            <button onClick={next} className="rounded border border-white/30 px-6 py-2 text-sm tracking-widest text-white hover:bg-white/10">
              CREDITS
            </button>
          </div>
        </div>
      )}
      {step === cards.length + 2 && (
        <div className="absolute inset-0 overflow-hidden" onClick={(e) => e.stopPropagation()}>
          <div className="absolute inset-x-0 bottom-0 flex flex-col items-center text-center animate-[credits_60s_linear_forwards]">
            {CREDITS.map((line, i) => (
              <div key={i} className={line === "TITAN WALL" ? "py-6 font-serif text-5xl font-black text-white" : "py-1 text-sm text-slate-300"}>
                {line || "\u00a0"}
              </div>
            ))}
          </div>
          <div className="absolute bottom-4 right-4 flex gap-2">
            <button onClick={onMenu} className="rounded border border-white/30 bg-black/60 px-4 py-2 text-xs tracking-widest text-white hover:bg-white/10">
              MAIN MENU
            </button>
          </div>
        </div>
      )}
      <div className="absolute bottom-3 left-0 right-0 text-center text-[10px] tracking-widest text-slate-500">
        {step < last ? "Click to continue" : ""}
      </div>
      <style>{`@keyframes credits { from { transform: translateY(100%); } to { transform: translateY(-120%); } }`}</style>
    </div>
  );
}
