// Docs: docs/code/web/package.md
import { useEffect, useState, type RefObject } from "react";
import type { RequestProgress } from "@tessera/contracts";
import type { MessageKey } from "./i18n/en.ts";
import { t } from "./i18n/translate.ts";
import type { RequestControl } from "./request-control.ts";

// Progress while a request runs (GEN-16, CLI-07, ADR 0010): the stage the server says it is in,
// in plain words, and the seconds since the person sent it. The seconds are counted here, so they
// keep going while the browser checks a new tool itself, between the server's parts.

const STAGE_KEYS: Partial<Record<NonNullable<RequestProgress["stage"]>, MessageKey>> = {
  waiting: "request.stage.waiting",
  intent: "request.stage.intent",
  create: "request.stage.create",
  edit: "request.stage.edit",
  repair: "request.stage.repair",
  data: "request.stage.data",
  discuss: "request.stage.discuss",
};

/** What a stage is called; any other, or none, is the general working message. */
export function stageText(stage: RequestProgress["stage"]): string {
  const key = stage ? STAGE_KEYS[stage] : undefined;
  return t(key ?? "request.working");
}

export type Progress = { status: string; elapsed: string };

/** Asks the server every second while the request in `control` runs; `undefined` when none does. */
export function useRequestProgress(control: RefObject<RequestControl | null>, running: boolean) {
  const [progress, setProgress] = useState<Progress>();
  useEffect(() => {
    const owner = control.current;
    if (!owner || !running) {
      setProgress(undefined);
      return;
    }
    const started = Date.now();
    let stage: RequestProgress["stage"] = null;
    let asking = false;
    let over = false;
    const show = () =>
      setProgress({
        status: stageText(stage),
        elapsed: t("request.elapsed", { seconds: Math.floor((Date.now() - started) / 1000) }),
      });
    const tick = () => {
      show();
      if (asking) return;
      asking = true;
      owner
        .progress()
        .then((now) => {
          // A stage the server no longer runs keeps the last one shown until the next starts.
          if (!over && now.stage) stage = now.stage;
        })
        // Progress is only a display: a failed ask leaves the last stage shown.
        .catch(() => undefined)
        .finally(() => {
          asking = false;
          if (!over) show();
        });
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => {
      over = true;
      clearInterval(timer);
    };
  }, [control, running]);
  return progress;
}
