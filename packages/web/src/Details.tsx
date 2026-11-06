import type { HostResult, LedgerCall, LedgerRequest, Workspace } from "@tessera/contracts";
import { useEffect, useState } from "react";
import { ask, problemText } from "./host-api.ts";
import { t } from "./i18n/translate.ts";

// The details view (APP-09, UX-06): behind its own control and out of the person's way, the
// workspace's recent requests from the call ledger, each model call with its time, tokens and
// outcome, and why anything failed (OBS-01, GEN-10); then the current tool's code. The person's
// plain message stays where it was; this is for looking closer. It loads only when opened.

const when = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "medium" });
const at = (time: string) => when.format(new Date(time));

/** Unknown is said as unknown, never as 0 (CLI-04). */
const count = (value: number | null) => (value === null ? t("details.unknown") : String(value));
const seconds = (ms: number | null) =>
  ms === null ? t("details.unknown") : t("details.seconds", { seconds: (ms / 1000).toFixed(1) });

type Props = {
  workspace: Workspace;
  /** Moves on each time the tool or its data changes, so an open view loads again. */
  changes: number;
};

type Details = HostResult<"details.get">;

export function Details({ workspace, changes }: Props) {
  const id = workspace.id;
  const [open, setOpen] = useState(false);
  const [details, setDetails] = useState<Details | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!open) return;
    let current = true;
    ask("details.get", { workspaceId: id }).then(
      (found) => {
        if (!current) return;
        setDetails(found);
        setMessage("");
      },
      (error: unknown) => {
        if (current) setMessage(t("app.problem", { message: problemText(error) }));
      },
    );
    return () => {
      current = false;
    };
  }, [open, id, workspace.currentVersion, workspace.dataRevision, changes]);

  return (
    <section aria-labelledby="details-heading" className="details">
      <h2 id="details-heading">{t("details.heading")}</h2>
      <button
        type="button"
        aria-expanded={open}
        aria-controls="details-body"
        onClick={() => setOpen(!open)}
      >
        {open ? t("details.hide") : t("details.show")}
      </button>
      {open && (
        <div id="details-body">
          <p role="status">{message || (details ? "" : t("details.loading"))}</p>
          {details && <Body details={details} />}
        </div>
      )}
    </section>
  );
}

function Body({ details }: { details: Details }) {
  return (
    <>
      <h3>{t("details.requestsHeading")}</h3>
      {details.requests.length === 0 ? (
        <p>{t("details.noRequests")}</p>
      ) : (
        <ol className="details-requests">
          {details.requests.map((request) => (
            <Request key={request.id} request={request} />
          ))}
        </ol>
      )}
      <h3>{t("details.sourceHeading")}</h3>
      {details.source === null ? (
        <p>{t("details.noSource")}</p>
      ) : (
        <>
          <p>
            {t("details.capabilities", {
              list: details.capabilities.join(", ") || t("details.none"),
            })}
          </p>
          {(["html", "css", "js"] as const).map((part) => (
            <details key={part}>
              <summary>{t(`details.source.${part}`)}</summary>
              <pre>
                <code>{details.source![part]}</code>
              </pre>
            </details>
          ))}
        </>
      )}
    </>
  );
}

function Request({ request }: { request: LedgerRequest }) {
  return (
    <li>
      <p>
        <strong>{at(request.startedAt)}</strong> {t(`details.kind.${request.kind}`)}:{" "}
        {request.outcome ?? t("details.running")}
      </p>
      {request.message && <p>{request.message}</p>}
      {request.findings.length > 0 && (
        <>
          <p>{t("details.findings")}</p>
          <ul>
            {request.findings.map((finding, index) => (
              <li key={index}>{finding}</li>
            ))}
          </ul>
        </>
      )}
      {request.calls.length > 0 && (
        <table>
          <caption>{t("details.callsCaption")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("details.stage")}</th>
              <th scope="col">{t("details.model")}</th>
              <th scope="col">{t("details.time")}</th>
              <th scope="col">{t("details.tokensIn")}</th>
              <th scope="col">{t("details.tokensCached")}</th>
              <th scope="col">{t("details.tokensOut")}</th>
              <th scope="col">{t("details.result")}</th>
            </tr>
          </thead>
          <tbody>
            {request.calls.map((call) => (
              <Call key={call.index} call={call} />
            ))}
          </tbody>
        </table>
      )}
    </li>
  );
}

function Call({ call }: { call: LedgerCall }) {
  const why = [
    ...call.diagnostics.map((line) => t("details.askedToFix", { line })),
    ...(call.outcome === "ok" ? [] : [call.error, call.message, call.detail]),
  ].filter((line): line is string => Boolean(line));
  return (
    <tr>
      <th scope="row">{call.stage}</th>
      <td>
        {call.model} ({call.effort})
      </td>
      <td>{seconds(call.durationMs)}</td>
      <td>{count(call.inputTokens)}</td>
      <td>{count(call.cachedInputTokens)}</td>
      <td>{count(call.outputTokens)}</td>
      <td>
        {t(`details.outcome.${call.outcome}`)}
        {why.length > 0 && (
          <ul>
            {why.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        )}
      </td>
    </tr>
  );
}
