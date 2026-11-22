import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { HostIcon } from "./HostIcon.tsx";
import { t } from "./i18n/translate.ts";

// Stable panes (APP-01, RUN-02): hiding or moving chat never reparents the sandbox.
export const SPLIT = { initial: 35, min: 25, max: 60, step: 5 } as const;
export const clampShare = (share: number): number =>
  Math.round(Math.min(SPLIT.max, Math.max(SPLIT.min, share)));
export function keyShare(key: string, share: number): number | undefined {
  if (key === "ArrowLeft" || key === "ArrowUp") return clampShare(share + SPLIT.step);
  if (key === "ArrowRight" || key === "ArrowDown") return clampShare(share - SPLIT.step);
  if (key === "Home") return SPLIT.min;
  if (key === "End") return SPLIT.max;
  return undefined;
}
// In the order the position menu shows them, two to a row.
const CORNERS = ["top-right", "top-left", "bottom-right", "bottom-left"] as const;
type Corner = (typeof CORNERS)[number];
const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const keep = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage can be disabled; controls still work for this visit.
  }
};
type Props = {
  first: ReactNode;
  second: ReactNode;
  /** The ask bar, given the control that opens the conversation to place inside it. */
  footer: (opener: ReactNode) => ReactNode;
  open: boolean;
  onOpen: (open: boolean) => void;
  expanded?: boolean;
};
export function Split({ first, second, footer, open, onOpen, expanded = false }: Props) {
  const [position, setPosition] = useState(() =>
    read("tessera.chatPosition") === "docked" ? "docked" : "floating",
  );
  const [corner, setCorner] = useState<Corner>(
    () => CORNERS.find((item) => item === read("tessera.chatCorner")) ?? "top-right",
  );
  const [share, setShare] = useState(() => {
    const value = Number(read("tessera.chatWidth"));
    return Number.isFinite(value) && value > 0 ? clampShare(value) : SPLIT.initial;
  });
  const [dragging, setDragging] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const closer = useRef<HTMLButtonElement>(null);
  const focusOnOpen = useRef(false);
  const id = useId();
  const menuId = `${id}-menu`;
  const visible = open && !expanded;
  useLayoutEffect(() => {
    if (visible && focusOnOpen.current) {
      closer.current?.focus();
      focusOnOpen.current = false;
    }
  }, [visible]);
  const move = (next: Corner) => {
    setCorner(next);
    keep("tessera.chatCorner", next);
  };
  const close = () => {
    onOpen(false);
    opener.current?.focus();
  };
  return (
    <div
      ref={box}
      className={["split", position, corner, visible && "conversation-open", dragging && "dragging"]
        .filter(Boolean)
        .join(" ")}
      style={{ "--chat-share": share + "%" } as React.CSSProperties}
    >
      <div className="split-second">{second}</div>
      <div
        className="split-divider"
        hidden={!visible || position !== "docked"}
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
          setShare(next);
          keep("tessera.chatWidth", String(next));
        }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragging(true);
        }}
        onPointerMove={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
          const rect = box.current!.getBoundingClientRect();
          const next = clampShare(((rect.right - event.clientX) / rect.width) * 100);
          setShare(next);
          keep("tessera.chatWidth", String(next));
        }}
        onLostPointerCapture={() => setDragging(false)}
      />
      <div
        id={id}
        className="split-first"
        hidden={!visible}
        onKeyDown={(event) => {
          // Escape first closes an open position menu, wherever focus is; then the conversation.
          const menuOpen = event.currentTarget.querySelector(":popover-open");
          if (event.key === "Escape" && !event.defaultPrevented && !menuOpen) {
            event.preventDefault();
            close();
          }
        }}
      >
        <header className="conversation-head">
          {position === "floating" && (
            <button
              type="button"
              className="icon-button conversation-drag"
              aria-label={t("chat.move")}
              title={t("chat.move")}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                setDragging(true);
              }}
              onPointerUp={(event) => {
                if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
                const rect = box.current!.getBoundingClientRect();
                move(
                  ((event.clientY < rect.y + rect.height / 2 ? "top" : "bottom") +
                    "-" +
                    (event.clientX < rect.x + rect.width / 2 ? "left" : "right")) as Corner,
                );
              }}
              onLostPointerCapture={() => setDragging(false)}
              onKeyDown={(event) => {
                if (!event.key.startsWith("Arrow")) return;
                event.preventDefault();
                const vertical =
                  event.key === "ArrowUp"
                    ? "top"
                    : event.key === "ArrowDown"
                      ? "bottom"
                      : corner.split("-")[0];
                const horizontal =
                  event.key === "ArrowLeft"
                    ? "left"
                    : event.key === "ArrowRight"
                      ? "right"
                      : corner.split("-")[1];
                move((vertical + "-" + horizontal) as Corner);
              }}
            >
              <HostIcon name="grip" />
            </button>
          )}
          <h2>{t("chat.label")}</h2>
          <button
            type="button"
            className="conversation-position"
            popoverTarget={menuId}
            aria-label={t("chat.position")}
          >
            <HostIcon name="panel" />
            {t("chat.positionShort")}
            <span aria-hidden="true">⌄</span>
          </button>
          {/* Float or dock, then, while floating, the corner: radio groups, so arrow keys move
              between choices, and a choice moves the panel at once. */}
          <div id={menuId} popover="auto" className="conversation-menu">
            <fieldset>
              <legend className="visually-hidden">{t("chat.position")}</legend>
              {(["floating", "docked"] as const).map((value) => (
                <label key={value}>
                  <input
                    type="radio"
                    name={`${id}-position`}
                    value={value}
                    checked={position === value}
                    onChange={() => {
                      setPosition(value);
                      keep("tessera.chatPosition", value);
                    }}
                  />
                  {t(value === "floating" ? "chat.float" : "chat.dock")}
                </label>
              ))}
            </fieldset>
            {position === "floating" && (
              <fieldset className="conversation-corners">
                <legend>{t("chat.corner")}</legend>
                {CORNERS.map((item) => (
                  <label key={item}>
                    <input
                      type="radio"
                      name={`${id}-corner`}
                      value={item}
                      checked={corner === item}
                      onChange={() => move(item)}
                    />
                    {t(`chat.${item}`)}
                  </label>
                ))}
              </fieldset>
            )}
          </div>
          <button
            ref={closer}
            type="button"
            className="icon-button"
            aria-label={t("chat.close")}
            title={t("chat.close")}
            onClick={close}
          >
            <HostIcon name="close" />
          </button>
        </header>
        {first}
        <p className="conversation-hint">{t("chat.hint")}</p>
      </div>
      <footer className="ask-footer">
        {footer(
          <button
            ref={opener}
            type="button"
            className="ask-open"
            aria-expanded={visible}
            aria-controls={id}
            onClick={() => {
              if (visible) closer.current?.focus();
              else {
                focusOnOpen.current = true;
                onOpen(true);
              }
            }}
          >
            <HostIcon name="chat" />
            <span>{t("chat.open")}</span>
          </button>,
        )}
      </footer>
    </div>
  );
}
