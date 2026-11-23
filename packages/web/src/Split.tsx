import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
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
// A phone, or any window this narrow (f-mobile-chat): the conversation opens as a modal sheet
// above the ask bar. The workspace has no side padding here, so the window is its width.
const PHONE = "(max-width: 44rem)";
const onPhoneChange = (changed: () => void) => {
  if (typeof matchMedia !== "function") return () => {};
  const query = matchMedia(PHONE);
  query.addEventListener("change", changed);
  return () => query.removeEventListener("change", changed);
};
const onPhone = () => typeof matchMedia === "function" && matchMedia(PHONE).matches;
const FOCUSABLE =
  "button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select, [tabindex]";

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
  const phone = useSyncExternalStore(onPhoneChange, onPhone, () => false);
  // The sheet is modal: the tool and its header are inert, focus stays in the sheet and the ask
  // bar under it, and Escape or the scrim closes it, focus returning to Open conversation.
  const sheet = visible && phone;
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
      className={[
        "split",
        position,
        corner,
        visible && "conversation-open",
        sheet && "sheet",
        dragging && "dragging",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ "--chat-share": share + "%" } as React.CSSProperties}
      onKeyDown={(event) => {
        if (!sheet) return;
        if (event.key === "Escape" && !event.defaultPrevented) {
          event.preventDefault();
          close();
          return;
        }
        if (event.key !== "Tab") return;
        // Tab wraps between the sheet and the ask bar, the only parts not inert.
        const controls = [
          ...event.currentTarget.querySelectorAll<HTMLElement>(
            `.split-first :is(${FOCUSABLE}), .ask-footer :is(${FOCUSABLE})`,
          ),
        ].filter((element) => element.tabIndex >= 0 && element.getClientRects().length > 0);
        const first = controls[0];
        const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
    >
      <div className="split-second" inert={sheet}>
        {second}
      </div>
      {sheet && <div className="sheet-scrim" aria-hidden="true" onClick={close} />}
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
        role={sheet ? "dialog" : undefined}
        aria-modal={sheet ? true : undefined}
        aria-label={sheet ? t("chat.label") : undefined}
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
          {position === "floating" && !sheet && (
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
