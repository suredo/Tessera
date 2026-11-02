import type {
  Loss,
  RecoverySnapshot,
  RestoreResult,
  UndoEntry,
  Workspace,
  WorkspaceVersion,
} from "@tessera/contracts";
import { useEffect, useState } from "react";
import { ask, problemText } from "./host-api.ts";
import { t } from "./i18n/translate.ts";

// The open workspace's history (APP-05): its tool versions, newest first, with restore; undo of
// its last data change (DATA-04); and the copies kept before a restore that lost data (DATA-10).
// A restore is planned first and runs only once the person confirms what the plan says: that the
// data stays, or exactly which values it would lose. Cancelling changes nothing.

const when = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });
const at = (time: string) => when.format(new Date(time));

type Pending = {
  version: WorkspaceVersion;
  /** The data revision the plan was made against; the restore is refused if it moved. */
  revision: number;
  losses: readonly Loss[];
  confirmation?: string;
};

type Props = {
  workspace: Workspace;
  /** Moves on each time the running tool saves a change, so the history loads it. */
  changes: number;
  /** Called after a restore or an undo changed the workspace, so the app reloads it. */
  onChanged: (message: string) => Promise<void>;
};

/** A lost value as the person reads it: where it was, and what it held. */
export const lossText = (loss: Loss) => {
  const value = JSON.stringify(loss.value);
  const steps = loss.steps ?? loss.path.map((field) => ({ field }));
  const last = steps.findLastIndex((step) => "item" in step);
  const field = steps
    .slice(last + 1)
    .map((step) => ("field" in step ? step.field : ""))
    .join(" › ");
  if (last === -1) return t("history.lossField", { field, value });
  // Where it was: items by their names, never their IDs (GEN-12). A list's name is left out
  // before an item that has a name, and kept, as "an item in", for one that has none.
  const where = steps
    .slice(0, last + 1)
    .flatMap((step, index, before) => {
      if ("field" in step) return "item" in (before[index + 1] ?? {}) ? [] : [step.field];
      if (step.item !== null) return [step.item];
      return [
        index === 0 || before.slice(0, index).every((s) => "field" in s)
          ? t("history.unnamedFirst", { list: step.in })
          : t("history.unnamed", { list: step.in }),
      ];
    })
    .join(" › ");
  return field ? t("history.loss", { where, field, value }) : t("history.lossItem", { where });
};

export function History({ workspace, changes, onChanged }: Props) {
  const id = workspace.id;
  const [versions, setVersions] = useState<WorkspaceVersion[]>([]);
  const [entries, setEntries] = useState<UndoEntry[]>([]);
  const [snapshots, setSnapshots] = useState<RecoverySnapshot[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [message, setMessage] = useState("");

  // Loaded again whenever the tool or its data changes, including each change the tool saves.
  useEffect(() => {
    let current = true;
    Promise.all([
      ask("versions.list", { workspaceId: id }),
      ask("undo.list", { workspaceId: id }),
      ask("snapshots.list", { workspaceId: id }),
    ]).then(
      ([list, undo, kept]) => {
        if (!current) return;
        setVersions([...list.versions].reverse());
        setEntries(undo.entries);
        setSnapshots(kept.snapshots);
      },
      (error: unknown) => {
        if (current) setMessage(error instanceof Error ? error.message : String(error));
      },
    );
    return () => {
      current = false;
    };
  }, [id, workspace.currentVersion, workspace.dataRevision, changes]);

  const problem = (error: unknown) => setMessage(t("app.problem", { message: problemText(error) }));
  // The data revision now: the tool may have changed the data since the list was loaded.
  const revisionNow = async () => {
    const { workspaces } = await ask("workspaces.list", {});
    return workspaces.find((w) => w.id === id)?.dataRevision ?? workspace.dataRevision;
  };
  const finish = async (result: RestoreResult, done: string) => {
    if (!result.ok) return setMessage(result.message);
    setMessage("");
    await onChanged(done);
  };

  const plan = async (version: WorkspaceVersion) => {
    try {
      const revision = await revisionNow();
      const planned = await ask("versions.planRestore", { workspaceId: id, hash: version.hash });
      if (!planned.ok) return setMessage(planned.message);
      setMessage("");
      setPending(
        planned.keepsData
          ? { version, revision, losses: [] }
          : { version, revision, losses: planned.losses, confirmation: planned.confirmation },
      );
    } catch (error) {
      problem(error);
    }
  };
  const restore = async ({ version, revision, confirmation }: Pending) => {
    setPending(null);
    try {
      const result = await ask("versions.restore", {
        workspaceId: id,
        hash: version.hash,
        expectedDataRevision: revision,
        ...(confirmation === undefined ? {} : { confirmation }),
      });
      await finish(result, t("history.restored", { index: version.index }));
    } catch (error) {
      problem(error);
    }
  };
  // Undoes the change the person sees, and only if it is still the newest: a tool may have
  // made another since, and that one would be the next to undo.
  const undo = async (entry: UndoEntry) => {
    try {
      const { entries: now } = await ask("undo.list", { workspaceId: id });
      if (now[0]?.number !== entry.number) {
        setEntries(now);
        return setMessage(t("history.changedSince"));
      }
      const result = await ask("undo.undo", { workspaceId: id, number: entry.number });
      if (!result.ok) return setMessage(result.message);
      setMessage("");
      await onChanged(t("history.undone"));
    } catch (error) {
      problem(error);
    }
  };
  const bringBack = async (snapshot: RecoverySnapshot) => {
    try {
      const result = await ask("snapshots.restore", {
        snapshotId: snapshot.id,
        expectedDataRevision: await revisionNow(),
      });
      await finish(result, t("history.broughtBack", { when: at(snapshot.createdAt) }));
    } catch (error) {
      problem(error);
    }
  };

  const latest = entries[0];
  return (
    <section aria-labelledby="history-heading" className="history">
      <h2 id="history-heading">{t("history.heading")}</h2>
      <p role="status">{message}</p>

      <h3>{t("history.undoHeading")}</h3>
      {latest ? (
        <p>
          <button type="button" onClick={() => void undo(latest)}>
            {t("history.undo")}
          </button>{" "}
          <span className="detail">
            {latest.kind === "whole"
              ? t("history.changeWhole", { when: at(latest.createdAt) })
              : latest.recordCount === 1
                ? t("history.changeRecord", { when: at(latest.createdAt) })
                : t("history.changeRecords", {
                    count: latest.recordCount,
                    when: at(latest.createdAt),
                  })}
          </span>
        </p>
      ) : (
        <p>{t("history.nothingToUndo")}</p>
      )}

      <h3>{t("history.versionsHeading")}</h3>
      <ul>
        {versions.map((version, place) => (
          <li key={version.index}>
            <span>{t("history.version", { index: version.index })}</span>{" "}
            <span className="detail">{at(version.createdAt)}</span>{" "}
            {place === 0 ? (
              <span className="badge">{t("history.current")}</span>
            ) : (
              <button
                type="button"
                aria-label={t("history.restoreLabel", { index: version.index })}
                disabled={pending !== null}
                onClick={() => void plan(version)}
              >
                {t("history.restore")}
              </button>
            )}
          </li>
        ))}
      </ul>

      {pending && (
        <div role="group" aria-labelledby="restore-heading" className="confirm">
          <h3 id="restore-heading">
            {t("history.confirmHeading", { index: pending.version.index })}
          </h3>
          {pending.confirmation === undefined ? (
            <p>{t("history.keepsData")}</p>
          ) : (
            <>
              <p>{t("history.losesData")}</p>
              <ul>
                {pending.losses.map((loss) => (
                  <li key={loss.path.join("\u0000")}>{lossText(loss)}</li>
                ))}
              </ul>
              <p>{t("history.keptCopy")}</p>
            </>
          )}
          <button type="button" className="primary" onClick={() => void restore(pending)}>
            {pending.confirmation === undefined ? t("history.confirm") : t("history.confirmLoss")}
          </button>{" "}
          <button type="button" onClick={() => setPending(null)}>
            {t("history.cancel")}
          </button>
        </div>
      )}

      {snapshots.length > 0 && (
        <>
          <h3>{t("history.snapshotsHeading")}</h3>
          <ul>
            {snapshots.map((snapshot) => (
              <li key={snapshot.id}>
                <span>{t("history.snapshot", { when: at(snapshot.createdAt) })}</span>{" "}
                <button
                  type="button"
                  aria-label={t("history.bringBackLabel", { when: at(snapshot.createdAt) })}
                  onClick={() => void bringBack(snapshot)}
                >
                  {t("history.bringBack")}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
