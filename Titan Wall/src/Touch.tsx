import { useEffect, useRef, useState } from "react";
import type { Game } from "./game/game";

/** True on phones and tablets: a coarse primary pointer or any touch point. */
export function isTouchDevice(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(pointer: coarse)").matches === true ||
    (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0)
  );
}

type Action = "hookL" | "hookR" | "slash" | "spear" | "reload" | "struggle";

/**
 * On-screen controls for phones and tablets.
 * Left: a move stick. Right: drag to look (the hook aims at the centre of the screen).
 * Right-hand buttons: slash, boost (hold), hooks (tap; hold keeps the rope), spear, reload, pause.
 * Each control writes straight into the game's touch state, the same flags the keyboard uses.
 */
export function TouchPad({ game, onPause }: { game: Game; onPause: () => void }) {
  const [stick, setStick] = useState<{ x: number; y: number } | null>(null);
  const stickOrigin = useRef<{ id: number; x: number; y: number } | null>(null);
  const lookId = useRef<number | null>(null);
  const lookLast = useRef({ x: 0, y: 0 });
  const padRef = useRef<HTMLDivElement>(null);
  const R = 42; // stick radius in px (matches the 120 px base)

  useEffect(() => {
    game.touch.active = true;
    return () => {
      game.touch.active = false;
      game.touch.mx = game.touch.my = 0;
      game.touch.boost = false;
      game.touch.hold[0] = game.touch.hold[1] = false;
    };
  }, [game]);

  const onStickDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    stickOrigin.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
    setStick({ x: 0, y: 0 });
  };
  const onStickMove = (e: React.PointerEvent) => {
    const o = stickOrigin.current;
    if (!o || o.id !== e.pointerId) return;
    let dx = (e.clientX - o.x) / R;
    let dy = (e.clientY - o.y) / R;
    const len = Math.hypot(dx, dy);
    if (len > 1) {
      dx /= len;
      dy /= len;
    }
    const dead = 0.12;
    const mx = Math.abs(dx) < dead ? 0 : (dx - Math.sign(dx) * dead) / (1 - dead);
    const my = Math.abs(dy) < dead ? 0 : (dy - Math.sign(dy) * dead) / (1 - dead);
    game.touch.mx = mx;
    game.touch.my = -my; // screen up is forward
    setStick({ x: dx * R, y: dy * R });
  };
  const onStickUp = (e: React.PointerEvent) => {
    if (stickOrigin.current?.id !== e.pointerId) return;
    stickOrigin.current = null;
    game.touch.mx = game.touch.my = 0;
    setStick(null);
  };

  // Look: any touch on the right side of the screen that is not a button turns the camera.
  const onLookDown = (e: React.PointerEvent) => {
    if (lookId.current !== null) return;
    lookId.current = e.pointerId;
    lookLast.current = { x: e.clientX, y: e.clientY };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onLookMove = (e: React.PointerEvent) => {
    if (lookId.current !== e.pointerId) return;
    game.touch.lookX += e.clientX - lookLast.current.x;
    game.touch.lookY += e.clientY - lookLast.current.y;
    lookLast.current = { x: e.clientX, y: e.clientY };
  };
  const onLookUp = (e: React.PointerEvent) => {
    if (lookId.current === e.pointerId) lookId.current = null;
  };

  const tap = (a: Action) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    game.touchAction(a);
  };
  const hold = (i: 0 | 1 | 2) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (i === 2) game.touch.boost = true;
    else {
      game.touch.hold[i] = true;
      game.touchAction(i === 0 ? "hookL" : "hookR");
    }
  };
  const release = (i: 0 | 1 | 2) => (e: React.PointerEvent) => {
    e.stopPropagation();
    if (i === 2) game.touch.boost = false;
    else game.touch.hold[i] = false;
  };

  return (
    <div
      ref={padRef}
      className="absolute inset-0 z-20 touch-none"
      style={{ touchAction: "none" }}
      onPointerDown={onLookDown}
      onPointerMove={onLookMove}
      onPointerUp={onLookUp}
      onPointerCancel={onLookUp}
    >
      {/* move stick, bottom-left */}
      <div
        className="absolute bottom-6 left-6 flex h-[120px] w-[120px] items-center justify-center rounded-full border border-white/25 bg-black/25"
        onPointerDown={onStickDown}
        onPointerMove={onStickMove}
        onPointerUp={onStickUp}
        onPointerCancel={onStickUp}
        style={{ touchAction: "none" }}
      >
        <div
          className="h-12 w-12 rounded-full border border-white/40 bg-white/25"
          style={{ transform: stick ? `translate(${stick.x}px, ${stick.y}px)` : undefined }}
        />
      </div>

      {/* pause, top-right */}
      <button
        className="absolute right-3 top-3 h-11 w-11 rounded-md border border-white/25 bg-black/40 text-lg text-white"
        onPointerDown={(e) => {
          e.stopPropagation();
          onPause();
        }}
        aria-label="Pause"
      >
        ❚❚
      </button>

      {/* action buttons, bottom-right */}
      <Btn label="SLASH" tone="red" size={96} className="bottom-6 right-4" down={tap("slash")} />
      <Btn label="BOOST" tone="blue" size={76} className="bottom-10 right-[118px]" down={hold(2)} up={release(2)} />
      <Btn label="HOOK L" tone="green" size={68} className="bottom-[124px] right-[118px]" down={hold(0)} up={release(0)} />
      <Btn label="HOOK R" tone="green" size={68} className="bottom-[124px] right-[8px]" down={hold(1)} up={release(1)} />
      <Btn label="SPEAR" tone="gold" size={60} className="bottom-[200px] right-[118px]" down={tap("spear")} />
      <Btn label="RELOAD" tone="gray" size={60} className="bottom-[200px] right-[8px]" down={tap("reload")} />
      <Btn label="GRAB" tone="gray" size={56} className="bottom-[274px] right-[8px]" down={tap("struggle")} />
    </div>
  );
}

const TONE: Record<string, string> = {
  red: "bg-red-600/55 border-red-200/60",
  blue: "bg-sky-600/50 border-sky-200/60",
  green: "bg-emerald-600/50 border-emerald-200/60",
  gold: "bg-amber-500/50 border-amber-100/60",
  gray: "bg-slate-600/50 border-slate-200/50",
};

function Btn({
  label,
  tone,
  size,
  className,
  down,
  up,
}: {
  label: string;
  tone: keyof typeof TONE;
  size: number;
  className: string;
  down: (e: React.PointerEvent) => void;
  up?: (e: React.PointerEvent) => void;
}) {
  return (
    <button
      className={`absolute flex select-none items-center justify-center rounded-full border text-[11px] font-bold tracking-wider text-white shadow-lg active:scale-95 ${TONE[tone]} ${className}`}
      style={{ width: size, height: size, touchAction: "none" }}
      onPointerDown={down}
      onPointerUp={up}
      onPointerCancel={up}
      onPointerLeave={up}
    >
      {label}
    </button>
  );
}
