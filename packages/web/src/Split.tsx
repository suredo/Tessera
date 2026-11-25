import {
  useEffect,
  useEffectEvent,
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
// Docked, the conversation opens `initial` px wide (decision A97); the rest are shares in percent.
export const SPLIT = { initial: 380, min: 25, max: 60, step: 5 } as const;
/** The opening width as a share of this room, so the divider can say where it is. */
export const initialShare = (width: number): number =>
  Math.min(SPLIT.max, Math.round((SPLIT.initial / width) * 100));
/** The narrowest share: never wider than the conversation opens, as in a very wide window. */
export const minShare = (width: number): number => Math.min(SPLIT.min, initialShare(width));
export const clampShare = (share: number, min: number = SPLIT.min): number =>
  Math.round(Math.min(SPLIT.max, Math.max(min, share)));
export function keyShare(key: string, share: number, min: number = SPLIT.min): number | undefined {
  if (key === "ArrowLeft" || key === "ArrowUp") return clampShare(share + SPLIT.step, min);
  if (key === "ArrowRight" || key === "ArrowDown") return clampShare(share - SPLIT.step, min);
  if (key === "Home") return min;
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
const onResize = (changed: () => void) => {
  window.addEventListener("resize", changed);
  return () => window.removeEventListener("resize", changed);
};
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
  // The share the person chose, if any; until then the conversation opens at SPLIT.initial px.
  const [chosen, setChosen] = useState(() => {
    const value = Number(read("tessera.chatWidth"));
    return Number.isFinite(value) && value > 0 ? value : null;
  });
  const width = useSyncExternalStore(onResize, () => window.innerWidth);
  const min = minShare(width);
  const share = chosen === null ? initialShare(width) : clampShare(chosen, min);
  const resize = (next: number) => {
    setChosen(next);
    keep("tessera.chatWidth", String(next));
  };
  const [dragging, setDragging] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const closer = useRef<HTMLButtonElement>(null);
  const focusOnOpen = useRef(false);
  const id = useId();
  const menuId = `${id}-menu`;
  const visible = open && !expanded;
  const phone = useSyncExternalStore(onPhoneChange, onPhone, () => false);
  // The sheet is modal: everything but the sheet, the ask bar under it and the app's notices
  // (Cancel, a request's choices) is inert, focus stays in those, and Escape or the scrim closes
  // it, focus returning to Open conversation. Inert, not aria-modal, makes the boundary, so the
  // ask bar and its progress stay inside it for screen readers too.
  const sheet = visible && phone;
  useEffect(() => {
    if (!sheet) return;
    const app = box.current?.closest(".app");
    const outside = [
      ...(app?.querySelectorAll<HTMLElement>(
        ":scope > header, :scope > .setup-banner, :scope > main > :not(.split)",
      ) ?? []),
    ];
    for (const element of outside) element.inert = true;
    return () => {
      for (const element of outside) element.inert = false;
    };
  }, [sheet]);
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
  // Keys while the sheet is open, wherever focus is in what stays usable, notices included:
  // Escape closes it, and Tab wraps through the sheet, the ask bar and the notices.
  const sheetKey = useEffectEvent((event: KeyboardEvent) => {
    if (event.key === "Escape" && !event.defaultPrevented) {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const app = box.current?.closest(".app") ?? box.current;
    if (!app) return;
    const controls = [
      ...app.querySelectorAll<HTMLElement>(
        `.split-first :is(${FOCUSABLE}), .ask-footer :is(${FOCUSABLE}), :scope > .notice :is(${FOCUSABLE})`,
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
  });
  useEffect(() => {
    if (!sheet) return;
    document.addEventListener("keydown", sheetKey);
    return () => document.removeEventListener("keydown", sheetKey);
  }, [sheet]);
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
      style={
        {
          "--chat-share": chosen === null ? SPLIT.initial + "px" : share + "%",
        } as React.CSSProperties
      }
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
        aria-valuemin={min}
        aria-valuemax={SPLIT.max}
        aria-valuenow={share}
        aria-valuetext={t("split.value", { share: String(share) })}
        onKeyDown={(event) => {
          const next = keyShare(event.key, share, min);
          if (next === undefined) return;
          event.preventDefault();
          resize(next);
        }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragging(true);
        }}
        onPointerMove={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
          const rect = box.current!.getBoundingClientRect();
          resize(clampShare(((rect.right - event.clientX) / rect.width) * 100, min));
        }}
        onLostPointerCapture={() => setDragging(false)}
      />
      <div
        id={id}
        className="split-first"
        hidden={!visible}
        role={sheet ? "dialog" : undefined}
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
