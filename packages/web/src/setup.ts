import {
  PROBE_ROUTE,
  probeResultSchema,
  PROVIDER_ROUTE,
  SETUP_ROUTE,
  setupReportSchema,
  type ProbeResult,
  type ProviderName,
  type SetupReport,
} from "@tessera/contracts";
import { HostError, type Send } from "./host-api.ts";
import { t } from "./i18n/translate.ts";

// The host app's side of the setup check and the probe (PLAT-03, APP-07, CLI-02): each answer is
// checked against the contract the server answers with (CON-01).

const fetchSend: Send = (url, init) => fetch(url, init);

async function read<T>(response: Response, parse: (json: unknown) => T | undefined): Promise<T> {
  const parsed = response.ok ? parse(await response.json().catch(() => undefined)) : undefined;
  if (parsed === undefined) throw new HostError(t("setup.unreadable"));
  return parsed;
}

/** The setup check: what Tessera needs to reach a model, and the data folder. */
export async function checkSetup(send: Send = fetchSend): Promise<SetupReport> {
  const response = await send(SETUP_ROUTE, { method: "GET" });
  return read(response, (json) => setupReportSchema.safeParse(json).data);
}

/** The probe: one small model call, which costs a call. */
export async function runProbe(send: Send = fetchSend): Promise<ProbeResult> {
  const response = await send(PROBE_ROUTE, { method: "POST" });
  return read(response, (json) => probeResultSchema.safeParse(json).data);
}

/** Chooses the program Tessera reaches a model through (CLI-01); the answer is the new check. */
export async function chooseProvider(
  provider: ProviderName,
  send: Send = fetchSend,
): Promise<SetupReport> {
  const response = await send(PROVIDER_ROUTE, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider }),
  });
  return read(response, (json) => setupReportSchema.safeParse(json).data);
}

/** The chosen program's check: what Tessera needs from it to reach a model. */
export const chosenCheck = (report: SetupReport) =>
  report.provider === "codex" ? report.codex : report.claude;

/** A size in bytes as the person reads it, such as "1.5 MB". */
export function formatBytes(bytes: number): string {
  const units = ["setup.size.kb", "setup.size.mb", "setup.size.gb"] as const;
  if (bytes < 1024) return t("setup.size.bytes", { n: bytes });
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return t(units[unit]!, { n: value.toFixed(1) });
}
