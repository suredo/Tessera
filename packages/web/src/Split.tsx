import { useRef, useState, type ReactNode } from "react";
import { t } from "./i18n/translate.ts";

// The chat beside the tool, with a divider between them (APP-01): a window splitter the person can
// drag, or move with the keyboard (APP-11): arrows by a step, Home and End to the limits. Where
// they don't fit side by side, the CSS stacks them and hides the divider. The width is the
// person's own, kept in this browser only; without storage it starts at the default each time.

/** The chat's share of the width, in percent: its default and limits, and a key press's step. */
export const SPLIT = { initial: 40, min: 25, max: 75, step: 5 } as const;
const KEY = "tessera.chatWidth";

/** A share kept within the limits, as a whole percent. */
export const clampShare = (share: number): number =>
  Math.round(Math.min(SPLIT.max, Math.max(SPLIT.min, share)));

const rememberedShare = (): number => {
  try {
    const kept = Number(localStorage.getItem(KEY));
    return kept ? clampShare(kept) : SPLIT.initial;
  } catch {
    return SPLIT.initial;
  }
};

/** The share a key moves the divider to, or undefined for a key it doesn't take. */
export function keyShare(key: string, share: number): number | undefined {
  if (key === "ArrowLeft" || key === "ArrowDown") return clampShare(share - SPLIT.step);
  if (key === "ArrowRight" || key === "ArrowUp") return clampShare(share + SPLIT.step);
  if (key === "Home") return SPLIT.min;
  if (key === "End") return SPLIT.max;
  return undefined;
}

type Props = {
  /** The chat. */
  first: ReactNode;
  /** The tool. */
  second: ReactNode;
  /** The tool takes the whole width: the chat and the divider step aside. */
  expanded?: boolean;
};

export function Split({ first, second, expanded = false }: Props) {
  const [share, setShare] = useState(rememberedShare);
  // While dragging, the panes take no pointer events: a tool's frame would swallow the moves.
  const [dragging, setDragging] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const keep = (next: number) => {
    setShare(next);
    try {
      localStorage.setItem(KEY, String(next));
    } catch {
      // Storage can be off; the divider still moves, it just isn't remembered.
    }
  };
  // Dragging: the share follows the pointer across the box, wherever it goes, until it is let go.
  const drag = (clientX: number) => {
    const rect = box.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    keep(clampShare(((clientX - rect.left) / rect.width) * 100));
  };
  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const move = (moved: PointerEvent) => drag(moved.clientX);
    setDragging(true);
    const stop = () => {
      setDragging(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  };
  return (
    <div
      ref={box}
      className={["split", expanded && "expanded", dragging && "dragging"]
        .filter(Boolean)
        .join(" ")}
      style={{ "--chat-share": `${share}%` } as React.CSSProperties}
    >
      <div className="split-first">{first}</div>
      <div
        className="split-divider"
        role="separator"
        tabIndex={0}
        aria-orientation="vertical"
        aria-label={t("split.label")}
        aria-valuemin={SPLIT.min}
        aria-valuemax={SPLIT.max}
        aria-valuenow={share}
        aria-valuetext={t("split.value", { share: String(share) })}
        onKeyDown={(event) => {
          const next = keyShare(event.key, share);
          if (next === undefined) return;
          event.preventDefault();
          keep(next);
        }}
        onPointerDown={startDrag}
      />
      <div className="split-second">{second}</div>
    </div>
  );
}
