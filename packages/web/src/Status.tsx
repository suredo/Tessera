import {
  PROVIDERS,
  type ProbeResult,
  type ProviderName,
  type SetupReport,
} from "@tessera/contracts";
import { useState } from "react";
import { HostIcon } from "./HostIcon.tsx";
import { t } from "./i18n/translate.ts";
import { chosenCheck, formatBytes } from "./setup.ts";

// The setup on Settings (APP-07, A101, l-settings), in two of its sections. The AI program: the
// program Tessera reaches a model through, Claude Code or Codex, chosen here with each one's status
// (CLI-01), each failure in plain words with its fix (PLAT-03), Check again, and the test with one
// request, which costs a call, so it is run only when asked and offered only once the checks pass
// (CLI-02). This computer: the data folder and its size, and Node.js.

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

/** A check's outcome: a passed one with a tick, a failed one in the problem's colour. */
function Outcome({
  ok,
  text,
  id,
  inline = false,
}: {
  ok: boolean;
  text: string;
  id?: string;
  /** A span, for inside a label, where a paragraph can't go. */
  inline?: boolean;
}) {
  const Tag = inline ? "span" : "p";
  return (
    <Tag id={id} className={ok ? "check-ok" : "check-problem"}>
      {ok && <HostIcon name="check" />}
      {text}
    </Tag>
  );
}

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
      <p id="programs-intro">{t("setup.provider.intro")}</p>
      {/* A check that couldn't be made says so, and can be tried again; it never looks endless. */}
      {problem && <p className="check-problem">{problem}</p>}
      {report === null ? (
        !problem && <p role="status">{t("setup.checking")}</p>
      ) : (
        // One at a time: a choice while a check runs, or a check while a choice is saved,
        // would race to the screen.
        <fieldset
          className="programs"
          aria-labelledby="status-heading"
          aria-describedby="programs-intro"
          disabled={choosing || checking}
        >
          {PROVIDERS.map((provider) => {
            const ok = (provider === "codex" ? report.codex : report.claude).ok;
            return (
              // The whole card is the radio's label, so a click anywhere on it chooses the program,
              // as in l-settings; the radio is named by the program alone, its status describes it.
              <label key={provider} className="program">
                <input
                  type="radio"
                  name="program"
                  value={provider}
                  checked={report.provider === provider}
                  aria-labelledby={`program-${provider}-name`}
                  aria-describedby={`program-${provider}`}
                  onChange={() => void choose(provider)}
                />
                <span>
                  <strong id={`program-${provider}-name`}>{t(PROGRAM_NAMES[provider])}</strong>
                  <Outcome
                    inline
                    id={`program-${provider}`}
                    ok={ok}
                    text={programStatus(report, provider)}
                  />
                </span>
              </label>
            );
          })}
          {chooseProblem && <p className="check-problem">{chooseProblem}</p>}
        </fieldset>
      )}
      {(report !== null || problem) && (
        <div className="status-actions">
          <button type="button" disabled={checking || choosing} onClick={() => void recheck()}>
            {t("setup.recheck")}
          </button>
          {report?.ready && (
            <button type="button" disabled={probing} onClick={() => void probe()}>
              {t("setup.probe.run")}
            </button>
          )}
        </div>
      )}
      {report !== null && !report.ready && <p className="detail">{t("setup.probe.waits")}</p>}
      <p role="status">{probed}</p>
    </section>
  );
}

/** This computer's part of the setup: where the data is kept, and Node.js (PLAT-03, A101). */
export function ThisComputer({ report }: { report: SetupReport | null }) {
  if (report === null) return null;
  return (
    <section aria-labelledby="computer-heading" className="this-computer">
      <h2 id="computer-heading">{t("setup.computer.heading")}</h2>
      <dl>
        <dt>{t("setup.folder.heading")}</dt>
        <dd>
          {t("setup.folder.where", {
            path: report.dataFolder.path,
            size: formatBytes(report.dataFolder.bytes),
          })}
        </dd>
        <dt>{t("setup.node.heading")}</dt>
        <dd>
          <Outcome
            ok={report.node.ok}
            text={
              report.node.ok
                ? t("setup.node.ok", { version: report.node.version })
                : report.node.message
            }
          />
        </dd>
      </dl>
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
      <HostIcon name="alert" />
      <div>
        {/* What is wrong first, then why, as in the redesign's j-start-setup (A100). */}
        <p>
          <strong>{t("setup.notReady")}</strong> {failed}
        </p>
        <button type="button" onClick={onOpen}>
          {t("setup.openStatus")}
        </button>
      </div>
    </div>
  );
}
