import {
  PROVIDERS,
  type ProbeResult,
  type ProviderName,
  type SetupReport,
} from "@tessera/contracts";
import { useState } from "react";
import { t } from "./i18n/translate.ts";
import { chosenCheck, formatBytes } from "./setup.ts";

// The status screen (APP-07): the program Tessera reaches a model through, Claude Code or Codex,
// chosen here with each one's status (CLI-01), Node.js, the data folder and its size, each failure
// in plain words with its fix (PLAT-03), and the probe, which costs a call, so it is run only when
// asked and offered only once the checks pass (CLI-02).

type Props = {
  /** The last check's report; null until one has come. */
  report: SetupReport | null;
  /** Why the last check couldn't be made, or "" if it was. */
  problem: string;
  /** Runs the check again; the screen shows the new report. */
  onRecheck: () => Promise<void>;
  onProbe: () => Promise<ProbeResult>;
  /** Chooses the program; the screen shows the new report. */
  onChoose: (provider: ProviderName) => Promise<void>;
};

const PROGRAM_NAMES = {
  "claude-code": "setup.provider.claude",
  codex: "setup.provider.codex",
} as const;

/** One program's status, in plain words. */
const programStatus = (report: SetupReport, provider: ProviderName) => {
  const check = provider === "codex" ? report.codex : report.claude;
  if (!check.ok) return check.message;
  return t(provider === "codex" ? "setup.codex.ok" : "setup.claude.ok", {
    version: check.version,
    path: check.executable,
  });
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

export function Status({ report, problem, onRecheck, onProbe, onChoose }: Props) {
  const [checking, setChecking] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [chooseProblem, setChooseProblem] = useState("");
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
  const choose = async (provider: ProviderName) => {
    setChoosing(true);
    setChooseProblem("");
    setProbed("");
    try {
      await onChoose(provider);
    } catch (error) {
      setChooseProblem(
        t("setup.provider.failed", {
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      setChoosing(false);
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
      {/* A check that couldn't be made says so, and can be tried again; it never looks endless. */}
      {problem && <p className="check-problem">{problem}</p>}
      {report === null ? (
        !problem && <p role="status">{t("setup.checking")}</p>
      ) : (
        <>
          <fieldset className="programs" disabled={choosing}>
            <legend>
              <h3>{t("setup.provider.heading")}</h3>
            </legend>
            <p id="programs-intro">{t("setup.provider.intro")}</p>
            {PROVIDERS.map((provider) => {
              const ok = (provider === "codex" ? report.codex : report.claude).ok;
              return (
                <div key={provider} className="program">
                  <label>
                    <input
                      type="radio"
                      name="program"
                      value={provider}
                      checked={report.provider === provider}
                      aria-describedby={`program-${provider}`}
                      onChange={() => void choose(provider)}
                    />
                    {t(PROGRAM_NAMES[provider])}
                  </label>
                  <p id={`program-${provider}`} className={ok ? "check-ok" : "check-problem"}>
                    {programStatus(report, provider)}
                  </p>
                </div>
              );
            })}
            {chooseProblem && <p className="check-problem">{chooseProblem}</p>}
          </fieldset>
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
        </>
      )}
      {(report !== null || problem) && (
        <button type="button" disabled={checking} onClick={() => void recheck()}>
          {t("setup.recheck")}
        </button>
      )}
      {report !== null && (
        <>
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
  /** Why the check couldn't be made, or "". */
  problem?: string;
  onOpen: () => void;
};

/** Says, on the main screens, that Tessera can't reach a model yet, and where the fix is (PLAT-03). */
export function SetupNotice({ report, problem = "", onOpen }: NoticeProps) {
  const chosen = report === null ? null : chosenCheck(report);
  const failed =
    report === null
      ? problem
      : !report.node.ok
        ? report.node.message
        : chosen !== null && !chosen.ok
          ? chosen.message
          : "";
  if (!failed) return null;
  return (
    <div className="setup-notice" role="alert">
      <p>{t("setup.notReady", { message: failed })}</p>
      <button type="button" onClick={onOpen}>
        {t("setup.openStatus")}
      </button>
    </div>
  );
}
