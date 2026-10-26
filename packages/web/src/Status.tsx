import type { ProbeResult, SetupReport } from "@tessera/contracts";
import { useState } from "react";
import { t } from "./i18n/translate.ts";
import { formatBytes } from "./setup.ts";

// The status screen (APP-07): Claude Code's status, Node.js, the data folder and its size, each
// failure in plain words with its fix (PLAT-03), and the probe, which costs a call, so it is run
// only when asked and offered only once the checks pass (CLI-02).

type Props = {
  report: SetupReport | null;
  /** Runs the check again; the screen shows the new report. */
  onRecheck: () => Promise<void>;
  onProbe: () => Promise<ProbeResult>;
};

const probeText = (result: ProbeResult) =>
  !result.ok
    ? t("setup.probe.failed", { message: result.message })
    : result.durationMs === null
      ? t("setup.probe.okUntimed", { model: result.model })
      : t("setup.probe.ok", {
          seconds: (result.durationMs / 1000).toFixed(1),
          model: result.model,
        });

export function Status({ report, onRecheck, onProbe }: Props) {
  const [checking, setChecking] = useState(false);
  const [probing, setProbing] = useState(false);
  const [probed, setProbed] = useState("");

  const recheck = async () => {
    setChecking(true);
    try {
      await onRecheck();
    } finally {
      setChecking(false);
    }
  };
  const probe = async () => {
    setProbing(true);
    setProbed(t("setup.probe.running"));
    try {
      setProbed(probeText(await onProbe()));
    } catch (error) {
      setProbed(
        t("setup.probe.failed", {
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      setProbing(false);
    }
  };

  return (
    <section aria-labelledby="status-heading" className="status">
      <h2 id="status-heading">{t("setup.heading")}</h2>
      {report === null ? (
        <p role="status">{t("setup.checking")}</p>
      ) : (
        <>
          <h3>{t("setup.claude.heading")}</h3>
          <p className={report.claude.ok ? "check-ok" : "check-problem"}>
            {report.claude.ok
              ? t("setup.claude.ok", {
                  version: report.claude.version,
                  path: report.claude.executable,
                })
              : report.claude.message}
          </p>
          <h3>{t("setup.node.heading")}</h3>
          <p className={report.node.ok ? "check-ok" : "check-problem"}>
            {report.node.ok
              ? t("setup.node.ok", { version: report.node.version })
              : report.node.message}
          </p>
          <h3>{t("setup.folder.heading")}</h3>
          <p>
            {t("setup.folder.where", {
              path: report.dataFolder.path,
              size: formatBytes(report.dataFolder.bytes),
            })}
          </p>
          <button type="button" disabled={checking} onClick={() => void recheck()}>
            {t("setup.recheck")}
          </button>
          <h3>{t("setup.probe.heading")}</h3>
          <p>{t("setup.probe.intro")}</p>
          {report.ready ? (
            <button type="button" disabled={probing} onClick={() => void probe()}>
              {t("setup.probe.run")}
            </button>
          ) : (
            <p>{t("setup.probe.waits")}</p>
          )}
          <p role="status">{probed}</p>
        </>
      )}
    </section>
  );
}

type NoticeProps = {
  report: SetupReport | null;
  onOpen: () => void;
};

/** Says, on the main screens, that Tessera can't reach a model yet, and where the fix is (PLAT-03). */
export function SetupNotice({ report, onOpen }: NoticeProps) {
  if (report === null || report.ready) return null;
  const problem = !report.node.ok ? report.node : !report.claude.ok ? report.claude : undefined;
  return (
    <div className="setup-notice" role="alert">
      <p>{t("setup.notReady", { message: problem?.message ?? "" })}</p>
      <button type="button" onClick={onOpen}>
        {t("setup.openStatus")}
      </button>
    </div>
  );
}
