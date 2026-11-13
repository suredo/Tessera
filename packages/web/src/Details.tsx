import {
  PROFILES,
  type ChatMessage,
  type GenerateAnswer,
  type HostResult,
  type LedgerCall,
  type LedgerRequest,
  type LedgerTold,
  type ProfileId,
  type Workspace,
} from "@tessera/contracts";
import { useEffect, useState } from "react";
import { ask, problemText } from "./host-api.ts";
import type { MessageKey } from "./i18n/en.ts";
import { t } from "./i18n/translate.ts";

// The details view (APP-09, UX-06): behind its own control and out of the person's way, the
// workspace's recent requests from the call ledger, each model call with its time, tokens and
// outcome, and why anything failed (OBS-01, GEN-10); then the current tool's code. Requests that
// made no workspace, such as a failed first creation, are listed too, so their reasons can be
// seen from the empty screen as well. The person's plain message stays where it was; this is for
// looking closer. It loads only when opened, and again after every request while open.

const when = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "medium" });
const at = (time: string) => when.format(new Date(time));

/** Unknown is said as unknown, never as 0 (CLI-04). */
const count = (value: number | null) => (value === null ? t("details.unknown") : String(value));
const seconds = (ms: number | null) =>
  ms === null ? t("details.unknown") : t("details.seconds", { seconds: (ms / 1000).toFixed(1) });

// The ledger keeps the host's own names for steps and outcomes; the person reads plain words
// (GEN-12, UX-05). A name with no words yet is shown as it is, rather than hidden.
const STAGES: Record<string, MessageKey> = {
  intent: "details.stage.intent",
  create: "details.stage.create",
  edit: "details.stage.edit",
  repair: "details.stage.repair",
  data: "details.stage.data",
  research: "details.stage.research",
  review: "details.stage.review",
  acceptance: "details.stage.acceptance",
  discuss: "details.stage.discuss",
};
const OUTCOMES: Record<string, MessageKey> = {
  candidate: "details.ended.candidate",
  answer: "details.ended.answer",
  failed: "details.ended.failed",
  data_changed: "details.ended.data_changed",
  data_confirmation: "details.ended.data_confirmation",
  open_saved: "details.ended.open_saved",
  discussion: "details.ended.discussion",
};
// What an answer said, typed by the contract's one list of answers, so none is left without words.
const ANSWERS: Record<GenerateAnswer, MessageKey> = {
  clarify: "details.answer.clarify",
  unsupported: "details.answer.unsupported",
  cannot: "details.answer.cannot",
  ask_to_split: "details.answer.ask_to_split",
  not_yet: "details.answer.not_yet",
  unchanged: "details.answer.unchanged",
  stale: "details.answer.stale",
  data_unchanged: "details.answer.data_unchanged",
  data_cancelled: "details.answer.data_cancelled",
  data_stale: "details.answer.data_stale",
  data_clarify: "details.answer.data_clarify",
  data_cannot: "details.answer.data_cannot",
};
const named = (names: Record<string, MessageKey>, name: string) => {
  const key = names[name];
  return key ? t(key) : name;
};
/** One outcome: a kind, or an answer with what it said (as `answer:clarify`). */
const ended = (kind: string, answer?: string) =>
  kind === "answer" && answer
    ? t("details.ended.answered", { answer: named(ANSWERS, answer) })
    : named(OUTCOMES, kind);
/**
 * How a request ended; an answer says which (as `answer:clarify`), and a mixed request's entry
 * part follows its own (as `mixed_data:failed` or `mixed_data:answer:data_stale`).
 */
export function outcomeText(outcome: string | null): string {
  if (outcome === null) return t("details.running");
  const [kind, part, answer] = outcome.split(":");
  if (kind === "mixed_data" && part)
    return t("details.ended.mixed", { entries: ended(part, answer) });
  return ended(kind!, part);
}
export const stageText = (stage: string) => named(STAGES, stage);

type Props = {
  /** The open workspace; none on the empty screen, which still lists requests that made none. */
  workspace: Workspace | null;
  /**
   * Moves on whenever something may have been recorded: a request settled, or the tool or its
   * data changed. An open view loads again, so a failure's reasons show without reopening it.
   */
  changes: number;
};

type Details = HostResult<"details.get">;

/** Kept chats by subject: a workspace's ID, or "" for the empty screen's. */
type Chats = Record<string, readonly ChatMessage[]>;
const subject = (workspaceId: string | null) => workspaceId ?? "";

/**
 * What a request was told of the conversation before it (A62), as the chat still keeps it: the
 * messages it names, in order, and how many of them the chat no longer keeps.
 */
export function toldMessages(
  told: LedgerTold,
  chats: Chats,
): { shown: ChatMessage[]; gone: number } {
  const kept = new Map((chats[subject(told.workspaceId)] ?? []).map((m) => [m.number, m]));
  const shown = told.numbers.flatMap((number) => kept.get(number) ?? []);
  return { shown, gone: told.numbers.length - shown.length };
}

export function Details({ workspace, changes }: Props) {
  const id = workspace?.id ?? null;
  const [open, setOpen] = useState(false);
  const [details, setDetails] = useState<Details | null>(null);
  const [message, setMessage] = useState("");
  const [chats, setChats] = useState<Chats>({});

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
  }, [open, id, workspace?.currentVersion, workspace?.dataRevision, changes]);

  // The chats the requests were told from (A62), read so their messages can be shown; one that
  // can't be read shows as no longer kept.
  useEffect(() => {
    if (!details) return;
    let current = true;
    const subjects = new Set(
      [...details.requests, ...details.unattached].flatMap((request) =>
        request.told ? [request.told.workspaceId] : [],
      ),
    );
    void Promise.all(
      [...subjects].map((workspaceId) =>
        ask("chat.list", { workspaceId }).then(
          ({ messages }) => [subject(workspaceId), messages] as const,
          () => [subject(workspaceId), []] as const,
        ),
      ),
    ).then((read) => {
      if (current) setChats(Object.fromEntries(read) as Chats);
    });
    return () => {
      current = false;
    };
  }, [details]);

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
          {details && <Body details={details} chats={chats} hasWorkspace={id !== null} />}
        </div>
      )}
    </section>
  );
}

function Body({
  details,
  chats,
  hasWorkspace,
}: {
  details: Details;
  chats: Chats;
  hasWorkspace: boolean;
}) {
  return (
    <>
      {hasWorkspace && (
        <>
          <h3>{t("details.requestsHeading")}</h3>
          <Requests requests={details.requests} chats={chats} empty={t("details.noRequests")} />
        </>
      )}
      <h3>{t("details.unattachedHeading")}</h3>
      <Requests requests={details.unattached} chats={chats} empty={t("details.noUnattached")} />
      {hasWorkspace && details.source !== null && <Checks details={details} />}
      {hasWorkspace && (
        <>
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
      )}
    </>
  );
}

/**
 * What a profile's behavior check checks, in plain words for the person (GEN-12, UX-05): one line
 * for each of its rules, by its place among them, so the lines follow the profile's one definition
 * (P3) without showing it, as profiles never appear to the person (VER-03).
 */
export const ruleTexts = (profile: ProfileId): string[] =>
  PROFILES[profile].rules.map((_, i) => t(`details.rule.${profile}.${i + 1}` as MessageKey));

/**
 * The current version's checks (APP-05, VER-08): each in the host's own words, and for a behavior
 * check what it tried and checked, in plain words; a version whose behavior wasn't checked says
 * it isn't verified (UX-03).
 */
function Checks({ details }: { details: Details }) {
  const { checks, profile } = details;
  const behavior = checks.includes("behavior") && profile ? profile : null;
  return (
    <>
      <h3>{t("details.checksHeading")}</h3>
      {checks.length === 0 && <p>{t("details.check.none")}</p>}
      <ul className="details-checks">
        {checks.includes("code") && <li>{t("details.check.code")}</li>}
        {checks.includes("start") && <li>{t("details.check.start")}</li>}
        {behavior ? (
          <li>
            {t("details.check.behavior", { what: t(`history.tried.${behavior}`) })}
            <ul>
              {ruleTexts(behavior).map((rule) => (
                <li key={rule}>{rule}</li>
              ))}
            </ul>
          </li>
        ) : checks.includes("acceptance") ? (
          // Checks written from the request (VER-09): weaker than a profile's, and said so.
          <li>{t("details.check.acceptance")}</li>
        ) : (
          <li>{t("details.check.noBehavior")}</li>
        )}
      </ul>
    </>
  );
}

function Requests({
  requests,
  chats,
  empty,
}: {
  requests: LedgerRequest[];
  chats: Chats;
  empty: string;
}) {
  if (requests.length === 0) return <p>{empty}</p>;
  return (
    <ol className="details-requests">
      {requests.map((request) => (
        <Request key={request.id} request={request} chats={chats} />
      ))}
    </ol>
  );
}

/** The conversation a request was told (A62), as the chat still keeps it. */
function Told({ told, chats }: { told: LedgerTold; chats: Chats }) {
  const { shown, gone } = toldMessages(told, chats);
  return (
    <details>
      <summary>{t("details.told", { count: String(told.numbers.length) })}</summary>
      <ul>
        {shown.map((m) => (
          <li key={m.number}>
            {t(m.from === "person" ? "details.toldYou" : "details.toldTessera")}: {m.text}
          </li>
        ))}
      </ul>
      {gone > 0 && <p>{t("details.toldGone", { count: String(gone) })}</p>}
    </details>
  );
}

function Request({ request, chats }: { request: LedgerRequest; chats: Chats }) {
  return (
    <li>
      <p>
        <strong>{at(request.startedAt)}</strong> {t(`details.kind.${request.kind}`)}:{" "}
        {outcomeText(request.outcome)}
      </p>
      {request.message && <p>{request.message}</p>}
      {request.told && <Told told={request.told} chats={chats} />}
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

/** One model call's row: its step, model, time, tokens and outcome, and the code it answered with. */
export function Call({ call }: { call: LedgerCall }) {
  const why = [
    ...call.diagnostics.map((line) => t("details.askedToFix", { line })),
    ...(call.outcome === "ok" ? [] : [call.error, call.message, call.detail]),
  ].filter((line): line is string => Boolean(line));
  return (
    <tr>
      <th scope="row">{stageText(call.stage)}</th>
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
        {call.code && (
          // The code it answered with, also when the checks refused it (GEN-10).
          <details>
            <summary>{t("details.callCode")}</summary>
            {(["html", "css", "js"] as const).map(
              (part) =>
                call.code![part] !== undefined && (
                  <div key={part}>
                    <p>{t(`details.source.${part}`)}</p>
                    <pre>
                      <code>{call.code![part]}</code>
                    </pre>
                  </div>
                ),
            )}
          </details>
        )}
      </td>
    </tr>
  );
}
