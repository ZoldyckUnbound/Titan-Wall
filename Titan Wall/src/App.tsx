import { useCallback, useEffect, useRef, useState } from "react";
import { Ending } from "./Ending";
import { TouchPad, isTouchDevice } from "./Touch";
import { FAMILIES, MAX_LOADOUT, PERKS, TIER_WAVES, EMPTY_PROGRESS, isUnlocked, loadProgress, saveProgress, sanitizeLoadout } from "./game/perks";
import type { Progress } from "./game/perks";
import { Game } from "./game/game";
import type { BarkMsg, Phase, Snapshot, ToastMsg } from "./game/game";
import { loadAssets } from "./game/assets";

type TimedBark = BarkMsg & { at: number };
type TimedToast = ToastMsg & { at: number };

const pct = (v: number, m: number) => `${Math.max(0, Math.min(100, (v / m) * 100))}%`;

function Key({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <span
      className={`inline-flex h-6 items-center justify-center rounded border border-white/25 bg-white/10 px-1.5 font-mono text-[11px] font-semibold text-white ${
        wide ? "min-w-14" : "min-w-6"
      }`}
    >
      {children}
    </span>
  );
}

function Bar({ value, max, from, to, h = "h-2.5", flash }: { value: number; max: number; from: string; to: string; h?: string; flash?: boolean }) {
  return (
    <div className={`w-full overflow-hidden rounded-sm bg-black/55 ring-1 ring-white/15 ${h}`}>
      <div
        className={`h-full rounded-sm transition-[width] duration-100 ${flash ? "animate-pulse" : ""}`}
        style={{ width: pct(value, max), background: `linear-gradient(90deg, ${from}, ${to})` }}
      />
    </div>
  );
}

const CONTROLS: [React.ReactNode, string][] = [
  [<><Key>Q</Key> <Key>E</Key></>, "Fire left / right grapple (hold to stay attached)"],
  [<Key wide>SPACE</Key>, "Gas boost toward your anchors (or where you look)"],
  [<Key wide>SHIFT</Key>, "Reel in the rope — free speed, no gas"],
  [<Key>LMB</Key>, "Slash — needs speed at the nape to kill"],
  [<Key>R</Key>, "Swap dull blades (works mid-air)"],
  [<Key>F</Key>, "Throw a thunder spear along your aim (pins a Titan)"],
  [<><Key>W</Key><Key>A</Key><Key>S</Key><Key>D</Key></>, "Run / steer in the air"],
  [<Key>MOUSE</Key>, "Look (arrow keys also work)"],
  [<Key wide>TAB</Key>, "Open the map: districts, depots, teammates and titans"],
  [<Key>H</Key>, "Mount a horse from your supply (H again to dismount)"],
  [<Key>M</Key>, "Mute / unmute sound"],
];

const SAVE_KEY = "titanwall.save.v1";
const TUTORIAL_KEY = "titanwall.tutorial.v1";

function readSave(): number | null {
  try {
    const v = Number(localStorage.getItem(SAVE_KEY));
    return Number.isFinite(v) && v >= 1 ? Math.floor(v) : null;
  } catch {
    return null;
  }
}
function writeSave(wave: number | null) {
  try {
    if (wave == null) localStorage.removeItem(SAVE_KEY);
    else localStorage.setItem(SAVE_KEY, String(wave));
  } catch {
    /* storage unavailable (private mode): the save just doesn't persist */
  }
}
const tutorialDone = () => {
  try {
    return localStorage.getItem(TUTORIAL_KEY) === "1";
  } catch {
    return true;
  }
};
const markTutorialDone = () => {
  try {
    localStorage.setItem(TUTORIAL_KEY, "1");
  } catch {
    /* ignore */
  }
};

/** Tutorial copy. `touch` replaces `body` on phones and tablets, where the pad labels are the controls. */
const TUTORIAL: { title: string; body: string; touch?: string }[] = [
  { title: "Move and look", body: "W A S D runs along the ground. Move the mouse to look around. Arrow keys work too.", touch: "Drag the left stick to run. Drag anywhere on the right side of the screen to look around." },
  { title: "Grapple", body: "Press Q (left) or E (right) to fire a hook at a rooftop, wall or titan. Hold it to stay attached. The rope pulls you toward the anchor. Hooks only catch solid things, not open ground.", touch: "Tap HOOK L or HOOK R to fire at the centre of the screen. Hold one to stay attached; the rope pulls you toward the anchor. Hooks only catch solid things." },
  { title: "Boost", body: "Hold SPACE to fire your gas. It pushes you up and forward, even when you look down. Boosting burns gas; swinging and reeling are free.", touch: "Hold BOOST to fire your gas. It pushes you up and forward, even when you look down. Boosting burns gas." },
  { title: "Reel in", body: "Hold SHIFT to shorten the rope and swing in tighter. It costs no gas.", touch: "Keep a hook held and the rope tightens as you swing. Reeling costs no gas." },
  { title: "Landing", body: "Touch down gently or boost into the landing. A hard, flat crash into a wall or street hurts." },
  { title: "Cut the nape", body: "Reach a titan's glowing red nape at 12 m/s or faster and click LMB to slash. Blades dull as you cut; R swaps in a fresh set.", touch: "Reach a titan's glowing red nape at 12 m/s or faster and tap SLASH. Blades dull as you cut; RELOAD swaps in a fresh set." },
  { title: "Depots and squad", body: "Depots restock gas and blades and heal you. A depot goes offline when a titan is too close. Squad mates have one life each, so keep them alive." },
];

function Tutorial({ step, onNext, onSkip, touch }: { step: number; onNext: () => void; onSkip: () => void; touch: boolean }) {
  const t = TUTORIAL[step];
  const body = touch && t.touch ? t.touch : t.body;
  return (
    <div className="absolute inset-x-0 bottom-6 z-30 flex justify-center px-4">
      <div className="w-[32rem] max-w-full rounded-xl border border-amber-200/30 bg-black/85 p-5 shadow-2xl">
        <div className="flex items-baseline justify-between">
          <div className="text-[10px] tracking-[0.35em] text-amber-200/80">FIRST DEPLOYMENT · {step + 1} / {TUTORIAL.length}</div>
          <button onClick={onSkip} className="text-xs text-slate-400 hover:text-white">Skip tutorial</button>
        </div>
        <div className="mt-2 font-serif text-2xl font-bold text-white">{t.title}</div>
        <p className="mt-1.5 text-sm leading-relaxed text-slate-200">{body}</p>
        <div className="mt-4 flex justify-end">
          <button onClick={onNext} className="rounded bg-emerald-500 px-6 py-2 text-sm font-extrabold tracking-widest text-black hover:bg-emerald-400">
            {step + 1 < TUTORIAL.length ? "NEXT" : "DEPLOY"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Perk loadout picker: families in columns, locked perks show how many waves remain to unlock them. */
function PerkPicker({ progress, onLoadout }: { progress: Progress; onLoadout: (ids: string[]) => void }) {
  const picked = progress.loadout;
  const toggle = (id: string) => {
    if (picked.includes(id)) onLoadout(picked.filter((x) => x !== id));
    else if (picked.length < MAX_LOADOUT) onLoadout([...picked, id]);
  };
  return (
    <div className="mt-4 rounded-lg border border-white/15 bg-black/50 p-3 text-left">
      <div className="mb-2 flex items-baseline justify-between text-[10px] font-semibold tracking-widest text-slate-300">
        <span>PERKS · LOADOUT {picked.length}/{MAX_LOADOUT}</span>
        <span className="font-normal normal-case tracking-normal text-slate-400">{progress.totalWaves} waves cleared in total</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        {FAMILIES.map((f) => (
          <div key={f.id}>
            <div className="text-xs font-bold text-amber-200">{f.name}</div>
            <div className="mb-1 text-[10px] leading-snug text-slate-400">{f.blurb}</div>
            <div className="space-y-1">
              {PERKS.filter((p) => p.family === f.id).map((p) => {
                const ok = isUnlocked(p, progress.totalWaves);
                const on = picked.includes(p.id);
                return (
                  <button
                    key={p.id}
                    disabled={!ok || (!on && picked.length >= MAX_LOADOUT)}
                    onClick={() => toggle(p.id)}
                    className={`w-full rounded border px-2 py-1 text-left text-[11px] ${
                      on ? "border-emerald-300/70 bg-emerald-500/20 text-white" : ok ? "border-white/20 text-slate-200 hover:bg-white/10" : "border-white/10 text-slate-500"
                    } disabled:cursor-not-allowed`}
                  >
                    <div className="font-semibold">
                      {p.name} {!ok && <span className="font-normal">· {TIER_WAVES[p.tier] - progress.totalWaves} more waves</span>}
                    </div>
                    <div className="text-[10px] opacity-80">{p.desc}</div>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function IntroCard({ intro, onSkip }: { intro: NonNullable<Snapshot["intro"]>; onSkip: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.code === "Enter" || e.code === "NumpadEnter") onSkip();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onSkip]);
  return (
    <div
      className="absolute inset-0 z-30 flex cursor-pointer flex-col items-center justify-end bg-gradient-to-t from-black/90 via-black/40 to-black/10 pb-16"
      onClick={onSkip}
    >
      <div className="max-w-2xl px-6 text-center">
        <div className="text-[11px] font-bold tracking-[0.5em] text-amber-300/90">{intro.kicker}</div>
        <div className="mt-2 font-serif text-5xl font-black tracking-[0.12em] text-white drop-shadow-[0_2px_20px_rgba(0,0,0,0.9)]">{intro.title}</div>
        <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-slate-200">{intro.body}</p>
        <div className="mt-3 text-xs tracking-widest text-red-300">{intro.forecast}</div>
        <div className="mx-auto mt-5 h-1 w-64 overflow-hidden rounded bg-white/15">
          <div className="h-full bg-amber-300 transition-[width] duration-100" style={{ width: `${(1 - intro.left) * 100}%` }} />
        </div>
        <div className="mt-3 text-[11px] text-slate-400">Click or press ENTER to deploy now</div>
      </div>
    </div>
  );
}

type MapData = ReturnType<Game["mapSnapshot"]>;

/** Tab map, in the spirit of the Among Us map: the whole campaign area, or closer in. */
function MapView({ data, onClose }: { data: MapData; onClose: () => void }) {
  const [zoom, setZoom] = useState<"world" | "maria" | "near">("maria");
  const span = zoom === "world" ? data.mapR * 2 : zoom === "maria" ? 10400 : 2600;
  const cx = zoom === "near" ? data.player.x : 0;
  const cz = zoom === "near" ? data.player.z : 0;
  const fs = span / 70; // label size in map units
  const dot = span / 260;
  const vb = `${cx - span / 2} ${cz - span / 2} ${span} ${span}`;
  const inView = (x: number, z: number) => Math.abs(x - cx) < span / 2 + 200 && Math.abs(z - cz) < span / 2 + 200;
  const alive = data.squad.filter((b) => b.alive).length;
  const titans = data.titans;
  const kindSize: Record<string, number> = { normal: 1, abnormal: 1.1, armored: 1.3, colossal: 2.6, beast: 1.7, reiss: 2.2, hammer: 2, founding: 2.8 };
  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-black/85 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="mb-2 flex flex-wrap items-center gap-3 text-xs" onClick={(e) => e.stopPropagation()}>
        <div className="font-serif text-lg font-black tracking-widest text-white">MAP</div>
        {(["near", "maria", "world"] as const).map((z) => (
          <button
            key={z}
            onClick={() => setZoom(z)}
            className={`rounded border px-3 py-1 font-bold tracking-widest ${zoom === z ? "border-amber-300 bg-amber-300/20 text-amber-200" : "border-white/25 text-slate-300 hover:bg-white/10"}`}
          >
            {z === "near" ? "NEAR" : z === "maria" ? "MARIA" : "FULL MAP"}
          </button>
        ))}
        <div className="ml-auto flex gap-3 text-slate-300">
          <span><span className="text-white">●</span> You</span>
          <span><span className="text-emerald-300">●</span> Squad ({alive} alive)</span>
          <span><span className="text-red-400">●</span> Titans ({titans.length})</span>
          <span><span className="text-cyan-300">■</span> Depot</span>
          <span><span className="text-amber-300">▲</span> Shiganshina gate</span>
        </div>
        <button onClick={onClose} className="rounded border border-white/25 px-3 py-1 font-bold tracking-widest text-slate-200 hover:bg-white/10">CLOSE (TAB)</button>
      </div>
      <div className="min-h-0 flex-1">
        <svg viewBox={vb} className="h-full w-full rounded-lg border border-white/15 bg-[#1b2a22]" preserveAspectRatio="xMidYMid meet" onClick={(e) => e.stopPropagation()}>
          <circle cx={0} cy={0} r={data.mapR} fill="#22362b" />
          {data.rings.map((r) => (
            <g key={r.id}>
              <circle cx={0} cy={0} r={r.r} fill={r.id === "sina" ? "#3c4a57" : r.id === "rose" ? "#4a5560" : "#56606a"} stroke="#c9c2b2" strokeWidth={dot * 0.5} />
              {zoom !== "near" && (
                <text x={0} y={-r.r - dot} fontSize={fs} fill="#e5e7eb" textAnchor="middle" opacity={0.8}>{r.name}</text>
              )}
            </g>
          ))}
          {data.districts
            .filter((d) => inView(d.x, d.z))
            .map((d) => (
              <g key={d.id}>
                <circle cx={d.x} cy={d.z} r={d.r} fill="#8a7a58" fillOpacity={0.35} stroke="#e8d9b0" strokeOpacity={0.5} strokeWidth={dot * 0.3} />
                <text x={d.x} y={d.z} fontSize={fs * 0.9} fill="#fff7e0" textAnchor="middle" opacity={zoom === "world" ? 0.55 : 0.95}>{d.name}</text>
              </g>
            ))}
          {data.depots.filter((d) => inView(d.x, d.z)).map((d) => (
            <rect key={d.id} x={d.x - dot * 1.4} y={d.z - dot * 1.4} width={dot * 2.8} height={dot * 2.8} fill="#67e8f9" stroke="#0e7490" strokeWidth={dot * 0.3} />
          ))}
          <polygon
            points={`${data.gate.x},${data.gate.z - dot * 2} ${data.gate.x - dot * 1.6},${data.gate.z + dot * 1.4} ${data.gate.x + dot * 1.6},${data.gate.z + dot * 1.4}`}
            fill="#fcd34d"
          />
          {titans.filter((t) => inView(t.x, t.z)).map((t, i) => (
            <circle key={i} cx={t.x} cy={t.z} r={dot * (kindSize[t.kind] ?? 1) * 1.1} fill={t.kind === "beast" ? "#fb923c" : t.kind === "reiss" || t.kind === "founding" ? "#f43f5e" : "#dc2626"} stroke="#000" strokeWidth={dot * 0.2} />
          ))}
          {data.squad.filter((b) => b.alive && inView(b.x, b.z)).map((b) => (
            <g key={b.id}>
              <circle cx={b.x} cy={b.z} r={dot * (b.named ? 1.5 : 0.9)} fill={b.color} stroke="#000" strokeWidth={dot * 0.25} />
              {b.named && zoom !== "world" && (
                <text x={b.x} y={b.z - dot * 2.2} fontSize={fs * 0.7} fill={b.color} textAnchor="middle" fontWeight="bold">{b.name}</text>
              )}
            </g>
          ))}
          <circle cx={data.player.x} cy={data.player.z} r={dot * 2} fill={data.player.alive ? "#fff" : "#666"} stroke="#059669" strokeWidth={dot * 0.6} />
        </svg>
      </div>
    </div>
  );
}

function Menu({
  onStart,
  onContinue,
  savedWave,
  loading,
  note,
  progress,
  onLoadout,
}: {
  onStart: () => void;
  onContinue: (wave: number) => void;
  savedWave: number | null;
  loading: boolean;
  note: string;
  progress: Progress;
  onLoadout: (ids: string[]) => void;
}) {
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center overflow-y-auto bg-gradient-to-b from-black/70 via-black/45 to-black/80 p-4 backdrop-blur-[2px]">
      <div className="my-auto w-full max-w-5xl">
        <div className="text-center">
          <div className="text-xs tracking-[0.5em] text-amber-200/80">SCOUT REGIMENT · WALL DISTRICT 3</div>
          <h1 className="mt-2 font-serif text-6xl font-black tracking-wider text-white drop-shadow-[0_4px_24px_rgba(0,0,0,0.8)] sm:text-8xl">
            TITAN <span className="text-emerald-400">WALL</span>
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-sm text-slate-200/90">
            Swing between rooftops on twin-hook ODM gear, ride your momentum into the nape of a Titan — and keep your squad alive. They're counting on you.
          </p>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-3">
          {[
            { n: "Harlan", t: "The Veteran", c: "#7fb3ff", d: "Tactical & calm. Flanks Titans that are hunting allies, conserves gas, and calls out threats to you." },
            { n: "Vex", t: "The Hothead", c: "#ff7a4d", d: "Charges the biggest Titan at full boost. Huge damage — but burns out of gas and blades and gets grabbed." },
            { n: "Pip", t: "The Nervous Rookie", c: "#e8d95a", d: "Hovers high, hesitates, panics up close and crashes into roofs — but races in when an ally is grabbed." },
          ].map((b) => (
            <div key={b.n} className="rounded-lg border border-white/15 bg-black/45 p-3">
              <div className="flex items-baseline gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: b.c }} />
                <span className="font-bold text-white">{b.n}</span>
                <span className="text-xs" style={{ color: b.c }}>
                  {b.t}
                </span>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-300">{b.d}</p>
            </div>
          ))}
        </div>

        <div className="mt-4 grid gap-4 rounded-lg border border-white/15 bg-black/50 p-4 md:grid-cols-[1.3fr_1fr]">
          <div className="grid gap-2">
            {CONTROLS.map(([k, d], i) => (
              <div key={i} className="flex items-center gap-3 text-xs text-slate-200">
                <div className="flex w-28 shrink-0 gap-0.5">{k}</div>
                <div>{d}</div>
              </div>
            ))}
          </div>
          <div className="space-y-2 text-xs leading-relaxed text-slate-300">
            <div className="font-semibold text-white">Field notes</div>
            <p>
              <span className="text-red-300">Red rings</span> mark the nape. A cut at <b>12+ m/s</b> kills; anything slower or off-target barely scratches and <b>dulls your blades</b>.
            </p>
            <p>
              <span className="text-cyan-300">Cyan beacons</span> are supply depots — land to refill gas, blades and health.
            </p>
            <p>If a squadmate is grabbed, kill the Titan fast. If <i>you</i> are grabbed, mash SPACE.</p>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-white/15 bg-black/50 p-4">
            <div className="text-[10px] font-bold tracking-[0.3em] text-amber-200/90">THE CAMPAIGN</div>
            <div className="mt-1 text-xs text-slate-300">Lifetime waves cleared: <b className="text-white">{progress.totalWaves}</b> of 60</div>
            <ol className="mt-2 space-y-1.5 text-xs">
              {[
                [1, "Wall Maria holds", "Pure and abnormal titans in the fields"],
                [10, "The Colossal Breach", "The gate at Shiganshina falls"],
                [20, "Beast Titans", "Stones fall from the forest canopy"],
                [25, "Rod Reiss", "The titan with no face"],
                [60, "The Founding Titan", "The last stand"],
              ].map(([n, t, d]) => {
                const reached = progress.totalWaves >= (n as number);
                return (
                  <li key={n as number} className={`flex gap-2 ${reached ? "text-emerald-300" : "text-slate-300"}`}>
                    <span className="w-9 shrink-0 font-bold">{reached ? "✓" : ""}W{n}</span>
                    <span>
                      <b>{t as string}</b>
                      <span className="block text-[11px] text-slate-400">{d as string}</span>
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
          <div className="rounded-lg border border-white/15 bg-black/50 p-4 text-xs leading-relaxed text-slate-300">
            <div className="text-[10px] font-bold tracking-[0.3em] text-amber-200/90">THE THREE WALLS</div>
            <p className="mt-1">
              <b className="text-white">Wall Maria</b> (4,800 m) is the outer wall, <b className="text-white">Wall Rose</b> (3,800 m) the middle, and <b className="text-white">Wall Sina</b> (2,500 m) the innermost. The walls stand 72 m tall.
            </p>
            <p className="mt-2">
              The map is a 27 km region at 1:100,000 scale. Titans stay inside Maria until the wave-10 colossal breaches the gate.
            </p>
          </div>
          <div className="rounded-lg border border-white/15 bg-black/50 p-4 text-xs leading-relaxed text-slate-300">
            <div className="text-[10px] font-bold tracking-[0.3em] text-amber-200/90">NEW IN THIS BUILD</div>
            <ul className="mt-1 list-disc space-y-1 pl-4">
              <li>A day and night cycle: each in-game day lasts 10 minutes of play.</li>
              <li>Press <b className="text-white">TAB</b> for the map of every district, depot, teammate and titan.</li>
              <li>A title card before every wave shows what is coming.</li>
              <li>Fifty more Survey Corps recruits patrol Wall Maria.</li>
              <li>Boost burns far less gas, and the hook assist snaps near-misses onto a wall.</li>
            </ul>
          </div>
        </div>

        <PerkPicker progress={progress} onLoadout={onLoadout} />

        <div className="mt-5 flex flex-col items-center gap-2">
          <button
            disabled={loading}
            onClick={() => onStart()}
            className="rounded-md bg-emerald-500 px-12 py-3.5 text-lg font-extrabold tracking-[0.25em] text-black shadow-[0_0_40px_rgba(52,211,153,0.45)] transition hover:scale-105 hover:bg-emerald-400 disabled:opacity-50"
          >
            {loading ? "LOADING..." : "DEPLOY"}
          </button>
          {savedWave && !loading && (
            <button
              onClick={() => onContinue(savedWave)}
              className="rounded-md border border-amber-300/50 bg-black/40 px-8 py-2 text-sm font-bold tracking-widest text-amber-200 hover:bg-white/10"
            >
              CONTINUE FROM WAVE {savedWave}
            </button>
          )}
          <div className="text-[11px] text-slate-400">
            {isTouchDevice() ? "Phone or tablet · on-screen controls · tap PAUSE in the corner any time" : "Desktop · mouse + keyboard · click to capture the mouse (Esc to pause)"}
          </div>
          {note && <div className="text-[11px] text-amber-200/70">{note}</div>}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const miniEl = useRef<HTMLCanvasElement | null>(null);
  const miniRef = useCallback((el: HTMLCanvasElement | null) => {
    miniEl.current = el;
    gameRef.current?.setMinimap(el);
  }, []);
  const gameRef = useRef<Game | null>(null);
  const [progress, setProgress] = useState<Progress>(() => (typeof window === "undefined" ? EMPTY_PROGRESS : loadProgress()));
  const progressRef = useRef(progress);
  progressRef.current = progress;
  const [touch] = useState(() => isTouchDevice());
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [mapData, setMapData] = useState<MapData | null>(null);
  const [phase, setPhase] = useState<Phase>("menu");
  const [barks, setBarks] = useState<TimedBark[]>([]);
  const [toasts, setToasts] = useState<TimedToast[]>([]);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState("");
  const [tutStep, setTutStep] = useState<number | null>(null);
  const [savedWave, setSavedWave] = useState<number | null>(readSave);
  const [, force] = useState(0);

  useEffect(() => {
    let disposed = false;
    let game: Game | null = null;
    let iv = 0;
    const onResize = () => game?.resize(window.innerWidth, window.innerHeight);
    (async () => {
      const res = await loadAssets();
      if (disposed || !canvasRef.current) return;
      if (res.ok.length) setNote(`Loaded custom models: ${res.ok.length}`);
      else if (res.failed.length) setNote(`Could not load ${res.failed.length} custom model(s) — using built-in meshes`);
      game = new Game(
        {
          onBark: (b) => setBarks((p) => [...p.slice(-5), { ...b, at: performance.now() }]),
          onToast: (t) => setToasts((p) => [...p.slice(-3), { ...t, at: performance.now() }]),
          onPhase: (p) => setPhase(p),
          onWaveCleared: () =>
            setProgress((cur) => {
              const next = { ...cur, totalWaves: cur.totalWaves + 1 };
              saveProgress(next);
              return next;
            }),
        },
        { canvas: canvasRef.current, overlay: overlayRef.current ?? undefined, minimap: miniEl.current ?? undefined }
      );
      gameRef.current = game;
      game.setCinematics(true); // wave title cards
      game.run();
      setLoading(false);
    })();
    iv = window.setInterval(() => {
      if (game) {
        const snapNow = game.snapshot();
        setSnap(snapNow);
        if (snapNow.mapOpen) setMapData(game.mapSnapshot());
      }
      const now = performance.now();
      setBarks((p) => (p.some((b) => now - b.at > 9000) ? p.filter((b) => now - b.at < 9000) : p));
      setToasts((p) => (p.some((t) => now - t.at > 3200) ? p.filter((t) => now - t.at < 3200) : p));
      force((x) => x + 1);
    }, 100);
    window.addEventListener("resize", onResize);
    return () => {
      disposed = true;
      window.clearInterval(iv);
      window.removeEventListener("resize", onResize);
      game?.dispose();
      gameRef.current = null;
    };
  }, []);

  /** Start a run. `fromWave` retries a level or resumes a saved one; the tutorial runs once, on the first deploy. */
  const deploy = useCallback((fromWave?: number) => {
    const g = gameRef.current;
    if (!g) return;
    setBarks([]);
    setToasts([]);
    const pr = progressRef.current;
    g.setLoadout(sanitizeLoadout(pr.loadout, pr.totalWaves), pr.totalWaves);
    g.start(fromWave ?? 1);
    if (fromWave === undefined && !tutorialDone()) {
      setTutStep(0);
      g.pause(); // the tutorial holds the game until the player dismisses it
      return;
    }
    g.requestLock();
  }, []);
  const finishTutorial = useCallback(() => {
    markTutorialDone();
    setTutStep(null);
    gameRef.current?.resume(true);
  }, []);
  const saveRun = useCallback((wave: number) => {
    const next = Math.max(wave, savedWave ?? 0);
    writeSave(next);
    setSavedWave(next);
  }, [savedWave]);
  const resume = useCallback(() => gameRef.current?.resume(), []);

  const now = performance.now();
  const s = snap;
  const playing = phase === "playing" || phase === "paused";
  const lowGas = !!s && s.gas < 22;
  const dull = !!s && s.blade < 35;

  return (
    <div className="relative h-screen w-screen select-none overflow-hidden bg-slate-900 font-sans text-white" onContextMenu={(e) => e.preventDefault()}>
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      <canvas ref={overlayRef} className="pointer-events-none absolute inset-0 h-full w-full" />

      {/* danger vignette */}
      {s && playing && s.danger > 0.05 && (
        <div
          className="pointer-events-none absolute inset-0"
          style={{ boxShadow: `inset 0 0 ${80 + s.danger * 160}px rgba(255,30,10,${s.danger * 0.5})` }}
        />
      )}

      {/* HUD */}
      {s && playing && (
        <div className="pointer-events-none absolute inset-0 z-10">
          {/* squad */}
          <div className="absolute left-3 top-3 w-64 space-y-1.5">
            <div className="rounded-md border border-white/15 bg-black/50 p-2 backdrop-blur-sm">
              <div className="mb-1 flex items-center justify-between text-[10px] font-semibold tracking-widest text-slate-300">
                <span>SQUAD</span>
                <span>KILLS {s.kills}</span>
              </div>
              <div className="mb-2 flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-white" />
                <span className="text-xs font-bold">You</span>
                <div className="flex-1">
                  <Bar value={s.hp} max={s.maxHp} from="#e5484d" to="#ff8a7a" h="h-1.5" />
                </div>
              </div>
              {s.squad.map((b) => (
                <div key={b.id} className={`mb-1.5 last:mb-0 ${b.alive ? "" : "opacity-45"}`}>
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: b.color }} />
                    <span className="text-xs font-bold" style={{ color: b.color }}>
                      {b.name}
                    </span>
                    <span
                      className={`ml-auto text-[10px] font-semibold tracking-wide ${
                        b.alert || b.label === "PANICKING" || b.label === "RESCUING" ? "animate-pulse text-red-400" : "text-slate-300"
                      }`}
                    >
                      {b.alive ? b.label : "KIA — reinforcements next wave"}
                    </span>
                  </div>
                  {b.alive && (
                    <div className="mt-0.5 grid grid-cols-[1fr_0.6fr] gap-1.5">
                      <Bar value={b.hp} max={b.maxHp} from={b.color} to={b.color} h="h-1" />
                      <Bar value={b.gas} max={100} from="#38bdf8" to="#a5f3fc" h="h-1" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* wave banner */}
          <div className="absolute left-1/2 top-3 -translate-x-1/2 text-center">
            <div className="rounded-md border border-white/15 bg-black/50 px-5 py-1.5 backdrop-blur-sm">
              <div className="flex items-center gap-4 text-sm">
                <span className="font-black tracking-widest text-amber-200">WAVE {s.wave}</span>
                <span className="text-slate-200">
                  Titans <b className="text-red-300">{s.titansLeft}</b>
                </span>
                <span className="text-slate-200">
                  Nape cuts <b className="text-emerald-300">{s.napeKills}</b>
                </span>
                <span className="font-mono text-slate-100">{s.score.toLocaleString()}</span>
              </div>
              {s.waveClear && <div className="text-[11px] text-emerald-300">Next wave in {Math.ceil(s.waveTimer)}s — resupply!</div>}
            </div>
          </div>

          {/* minimap */}
          <div className="absolute right-3 top-3">
            {/* phones: the touch buttons fill the right edge, so the minimap is hidden (the canvas stays mounted) */}
            <div className={`rounded-md border border-white/20 bg-black/40 p-1 ${touch ? "hidden" : ""}`}>
              <canvas ref={miniRef} width={168} height={168} className="block h-[168px] w-[168px] rounded" />
            </div>
            <div className="mt-1 flex justify-between px-1 font-mono text-[11px] text-slate-200">
              <span>{Math.round(s.speed)} m/s</span>
              <span className={s.speed >= s.killSpeed ? "text-emerald-300" : "text-slate-400"}>
                {s.speed >= s.killSpeed ? "CUT READY" : `need ${s.killSpeed}`}
              </span>
            </div>
          </div>

          {/* radio log */}
          <div className="absolute bottom-40 left-3 w-[26rem] max-w-[46vw] space-y-1.5">
            {barks.map((b) => {
              const age = now - b.at;
              return (
                <div
                  key={b.id}
                  className="rounded-md border-l-4 bg-black/55 px-3 py-1.5 shadow-lg backdrop-blur-sm"
                  style={{ borderColor: b.color, opacity: age > 7000 ? Math.max(0, 1 - (age - 7000) / 2000) : 1, animation: "slidein .25s ease-out" }}
                >
                  <div className="text-[10px] font-bold tracking-wider" style={{ color: b.color }}>
                    {b.who.toUpperCase()} <span className="font-normal text-slate-400">· {b.title}</span>
                  </div>
                  <div className="text-[13px] italic leading-snug text-slate-50">“{b.text}”</div>
                </div>
              );
            })}
          </div>

          {/* toasts */}
          <div className="absolute left-1/2 top-[22%] w-[34rem] max-w-[90vw] -translate-x-1/2 space-y-1.5 text-center">
            {toasts.map((t) => (
              <div
                key={t.id}
                className={`mx-auto w-fit rounded px-4 py-1 font-bold tracking-wide ${
                  t.kind === "kill"
                    ? "bg-emerald-500/85 text-lg text-black"
                    : t.kind === "bad"
                      ? "bg-red-600/80 text-sm text-white"
                      : t.kind === "good"
                        ? "bg-sky-500/80 text-sm text-black"
                        : "bg-black/65 text-sm text-amber-100"
                }`}
                style={{ animation: "pop .25s ease-out" }}
              >
                {t.text}
              </div>
            ))}
          </div>

          {/* grabbed */}
          {s.grabbed && (
            <div className="absolute left-1/2 top-[58%] w-80 -translate-x-1/2 text-center">
              <div className="animate-pulse text-xl font-black tracking-widest text-red-400">GRABBED!</div>
              <div className="text-xs text-slate-200">MASH SPACE to break free</div>
              <div className="mt-1.5">
                <Bar value={s.struggle} max={1} from="#f59e0b" to="#fde047" h="h-3" />
              </div>
            </div>
          )}

          {/* bottom bars */}
          {/* phones: the bars sit left of the touch button column instead of centred over it */}
          <div className={touch ? "absolute bottom-4 left-[150px] right-[200px]" : "absolute bottom-4 left-1/2 w-[34rem] max-w-[92vw] -translate-x-1/2"}>
            <div className="rounded-lg border border-white/15 bg-black/55 p-3 backdrop-blur-sm">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="mb-1 flex items-center justify-between text-[10px] font-bold tracking-widest">
                    <span className={lowGas ? "animate-pulse text-red-400" : "text-cyan-200"}>{lowGas ? "LOW GAS" : "GAS"}</span>
                    <span className="font-mono text-slate-300">{Math.round(s.gas)}%</span>
                  </div>
                  <Bar value={s.gas} max={100} from={lowGas ? "#ef4444" : "#0ea5e9"} to={lowGas ? "#fb923c" : "#67e8f9"} h="h-3.5" flash={lowGas} />
                </div>
                <div>
                  <div className="mb-1 flex items-center justify-between text-[10px] font-bold tracking-widest">
                    <span className={dull ? "animate-pulse text-amber-300" : "text-slate-200"}>
                      {s.swap > 0 ? "SWAPPING BLADES..." : s.blade <= 0 ? "BLADES BROKEN — [R]" : dull ? "DULL — [R] SWAP" : "BLADES"}
                    </span>
                    <span className="flex items-center gap-1">
                      {[0, 1, 2, 3].map((i) => (
                        <span key={i} className={`h-2.5 w-1 rounded-sm ${i < s.spare ? "bg-slate-100" : "bg-white/15"}`} />
                      ))}
                    </span>
                    <span className="ml-2 flex items-center gap-1 text-[10px] text-sky-200" title="Thunder spears (F)">
                      {[0, 1, 2].map((i) => (
                        <span key={i} className={`h-3 w-0.5 rounded-sm ${i < s.spears ? "bg-sky-300" : "bg-white/15"}`} />
                      ))}
                    </span>
                  </div>
                  <Bar
                    value={s.swap > 0 ? s.swap * 100 : s.blade}
                    max={100}
                    from={s.swap > 0 ? "#a3e635" : s.blade < 35 ? "#b45309" : "#94a3b8"}
                    to={s.swap > 0 ? "#d9f99d" : s.blade < 35 ? "#fbbf24" : "#f1f5f9"}
                    h="h-3.5"
                    flash={dull && s.swap === 0}
                  />
                </div>
              </div>
              <div className="mt-2">
                <div className="mb-0.5 flex justify-between text-[10px] font-bold tracking-widest text-red-300">
                  <span>HEALTH</span>
                  <span className="font-mono text-slate-300">{Math.ceil(s.hp)}</span>
                </div>
                <Bar value={s.hp} max={s.maxHp} from="#dc2626" to="#fb7185" h="h-2" />
              </div>
              <div className="mt-2 flex items-center justify-between text-[10px] text-slate-400">
                <span>
                  Hooks:{" "}
                  <b className={s.hooks[0] === "attached" ? "text-emerald-300" : ""}>L {s.hooks[0] === "idle" ? "—" : s.hooks[0]}</b> ·{" "}
                  <b className={s.hooks[1] === "attached" ? "text-emerald-300" : ""}>R {s.hooks[1] === "idle" ? "—" : s.hooks[1]}</b>
                  {" · "}
                  <b className={s.mounted ? "text-amber-300" : ""}>
                    {s.mounted ? "RIDING (H)" : `HORSE ×${s.horses}${s.horses ? " (H)" : ""}`}
                  </b>
                </span>
                {s.resupplying && <span className="animate-pulse font-bold text-cyan-300">RESUPPLYING…</span>}
                <span>{touch ? "HOOK L/R · SLASH · BOOST · SPEAR · RELOAD" : "Q/E hooks · LMB slash · SPACE boost · SHIFT reel · R blades · F spear"}</span>
              </div>
            </div>
          </div>

          {s.lock === "edge" && phase === "playing" && !touch && (
            <div className="absolute bottom-2 right-3 max-w-xs rounded bg-black/60 px-2 py-1 text-right text-[10px] text-amber-200">
              Pointer lock unavailable — push the mouse toward the screen edges to turn (arrow keys also work).
            </div>
          )}
        </div>
      )}

      {/* phones in portrait: the controls are laid out for landscape, so ask for a turn (CSS-only, shows on rotate) */}
      {touch && (phase === "playing" || phase === "paused") && (
        <div className="absolute inset-0 z-40 hidden flex-col items-center justify-center gap-3 bg-slate-950/95 p-8 text-center portrait:flex">
          <div className="text-4xl">⟳</div>
          <div className="text-lg font-bold tracking-wider text-white">Turn your phone sideways</div>
          <div className="max-w-xs text-sm text-slate-300">Titan Wall is played in landscape, with the controls on each side of the screen.</div>
        </div>
      )}

      {/* on-screen controls for phones and tablets */}
      {s && phase === "playing" && touch && gameRef.current && (
        <TouchPad game={gameRef.current} onPause={() => gameRef.current?.pause()} />
      )}

      {/* wave title card: shown before every wave; click or Enter skips it */}
      {phase === "playing" && snap?.intro && (
        <IntroCard intro={snap.intro} onSkip={() => gameRef.current?.skipIntro()} />
      )}

      {/* Tab map: the whole of Wall Maria, Rose and Sina with every living unit */}
      {phase === "playing" && snap?.mapOpen && mapData && <MapView data={mapData} onClose={() => gameRef.current?.toggleMap()} />}

      {/* pause */}
      {phase === "paused" && tutStep === null && (
        <div
          className="absolute inset-0 z-20 flex cursor-pointer items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={(e) => {
            // clicking the backdrop resumes too; the request is a user gesture, so it can capture the mouse again
            if (e.target === e.currentTarget) resume();
          }}
        >
          <div className="rounded-xl border border-white/20 bg-slate-900/90 p-8 text-center">
            <div className="font-serif text-4xl font-black tracking-widest">PAUSED</div>
            <div className="mt-4 grid gap-1.5 text-left">
              {CONTROLS.slice(0, 5).map(([k, d], i) => (
                <div key={i} className="flex items-center gap-3 text-xs text-slate-200">
                  <div className="flex w-24 shrink-0 gap-0.5">{k}</div>
                  <div>{d}</div>
                </div>
              ))}
            </div>
            <div className="mt-4 text-[11px] text-slate-400">Click anywhere or press RESUME to capture the mouse again.</div>
            <button onClick={resume} className="pointer-events-auto mt-6 rounded bg-emerald-500 px-8 py-2.5 font-extrabold tracking-widest text-black hover:bg-emerald-400">
              RESUME
            </button>
          </div>
        </div>
      )}

      {/* death */}
      {phase === "dead" && s && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-red-950/70 backdrop-blur-sm">
          <div className="w-[26rem] max-w-[92vw] rounded-xl border border-red-400/30 bg-black/75 p-8 text-center">
            <div className="font-serif text-5xl font-black tracking-widest text-red-400">YOU FELL</div>
            <div className="mt-1 text-sm text-slate-300">{s.deathCause}</div>
            <div className="mt-5 grid grid-cols-3 gap-2 text-center">
              {[
                ["Wave", s.wave],
                ["Nape cuts", s.napeKills],
                ["Score", s.score.toLocaleString()],
              ].map(([k, v]) => (
                <div key={String(k)} className="rounded bg-white/10 p-2">
                  <div className="text-[10px] tracking-widest text-slate-400">{String(k).toUpperCase()}</div>
                  <div className="text-xl font-bold">{v}</div>
                </div>
              ))}
            </div>
            <div className="mt-6 flex flex-col gap-2">
              <button onClick={() => deploy(s.wave)} className="rounded bg-emerald-500 px-10 py-3 font-extrabold tracking-widest text-black hover:bg-emerald-400">
                RETRY WAVE {s.wave}
              </button>
              <button
                disabled={savedWave !== null && savedWave >= s.wave}
                onClick={() => saveRun(s.wave)}
                className="rounded border border-amber-300/40 px-10 py-2 text-sm font-bold tracking-widest text-amber-200 hover:bg-white/10 disabled:opacity-50"
              >
                {savedWave !== null && savedWave >= s.wave ? `SAVED — WAVE ${savedWave}` : `SAVE RUN (WAVE ${s.wave})`}
              </button>
              <button onClick={() => deploy(1)} className="rounded px-10 py-2 text-xs tracking-widest text-slate-300 hover:text-white">
                RESTART FROM WAVE 1
              </button>
            </div>
          </div>
        </div>
      )}

      {/* victory: epilogue, reward and credits */}
      {phase === "won" && s && (
        <Ending
          stats={{ wave: s.wave, napeKills: s.napeKills, kills: s.kills, score: s.score, squad: s.squad }}
          onPlayAgain={() => deploy(1)}
          onMenu={() => window.location.reload()}
        />
      )}

      {phase !== "menu" && phase !== "dead" && tutStep !== null && (
        <Tutorial
          step={tutStep}
          onNext={() => (tutStep + 1 < TUTORIAL.length ? setTutStep(tutStep + 1) : finishTutorial())}
          onSkip={finishTutorial}
          touch={touch}
        />
      )}
      {phase === "menu" && (
        <Menu
          onStart={() => deploy()}
          onContinue={(w) => deploy(w)}
          savedWave={savedWave}
          loading={loading}
          note={note}
          progress={progress}
          onLoadout={(ids) =>
            setProgress((cur) => {
              const next = { ...cur, loadout: sanitizeLoadout(ids, cur.totalWaves) };
              saveProgress(next);
              return next;
            })
          }
        />
      )}
    </div>
  );
}
