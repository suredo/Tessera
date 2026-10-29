import type { GenerateReply } from "@tessera/contracts";
import type { StagingResult } from "@tessera/runtime";
import { describe, expect, it, vi } from "vitest";
import { carryOut, dataOutcome, withInterfaceOutcome, type RequestDeps } from "../src/generate.ts";
import { en } from "../src/i18n/en.ts";

// The host app's side of a request (GEN-01, GEN-08): a candidate is staged behind the smoke check
// before it is activated, and the person reads what happened, never a success that didn't.

const candidate: GenerateReply = {
  kind: "candidate",
  operation: "create",
  workspaceId: "00000000-0000-4000-8000-000000000001",
  hash: "a".repeat(64),
  mountId: `v-${"a".repeat(64)}`,
  capabilities: [],
  syntheticData: { items: [] },
  expectedDataRevision: 1,
  name: "Shopping list",
  summary: "A list to tick off at the store.",
};

function deps(reply: GenerateReply, staged?: StagingResult) {
  const seen: { requests: unknown[]; stagings: Parameters<RequestDeps["stage"]>[0][] } = {
    requests: [],
    stagings: [],
  };
  const fake: RequestDeps = {
    finishData: () => Promise.resolve({ kind: "answer", answer: "data_unchanged" }),
    repairSmoke: () => Promise.resolve(reply),
    generate: (request) => {
      seen.requests.push(request);
      return Promise.resolve(reply);
    },
    stage: (options) => {
      seen.stagings.push(options);
      return Promise.resolve(staged ?? { outcome: "check-failed", check: "none", reason: "" });
    },
  };
  return { fake, seen };
}

describe("carrying out a request in the app (GEN-01, GEN-08)", () => {
  it("GEN-04 GEN-08: mixed data is asked only after activation/refresh, and a failed second part keeps the interface fact", async () => {
    const order: string[] = [];
    const mixed = deps(
      { ...candidate, operation: "edit", dataPending: true },
      { outcome: "activated", workspace: {} as never, migrationCount: 0 },
    );
    mixed.fake.stage = () => {
      order.push("activate");
      return Promise.resolve({ outcome: "activated", workspace: {} as never, migrationCount: 0 });
    };
    mixed.fake.finishData = () => {
      order.push("data");
      return Promise.resolve({
        kind: "failed",
        failure: "provider",
        message: "Usage limit reached.",
        findings: [],
      });
    };
    const result = await carryOut(
      "Make it dark and add Bread",
      candidate.workspaceId,
      mixed.fake,
      () => {
        order.push("refresh");
        return Promise.resolve();
      },
    );
    expect(order).toEqual(["activate", "refresh", "data"]);
    expect(result.message).toContain("Shopping list was updated.");
    expect(result.message).toContain("The entry changes weren't applied. Usage limit reached.");
    expect(result.openWorkspaceId).toBe(candidate.workspaceId);
    const finish = vi.fn(mixed.fake.finishData);
    mixed.fake.finishData = finish;
    mixed.fake.stage = () =>
      Promise.resolve({ outcome: "check-failed", check: "cancelled", reason: "Stopped" });
    await carryOut("mixed", candidate.workspaceId, mixed.fake);
    expect(finish).not.toHaveBeenCalled();
  });
  it("GEN-04 GEN-08: confirmation retains partial facts, and a lost data response is uncertain rather than falsely unapplied", async () => {
    const mixed = deps(
      { ...candidate, operation: "edit", dataPending: true },
      { outcome: "activated", workspace: {} as never, migrationCount: 0 },
    );
    mixed.fake.finishData = () =>
      Promise.resolve({
        kind: "data_confirmation",
        workspaceId: candidate.workspaceId,
        name: "Shopping list",
        token: "00000000-0000-4000-8000-000000000003",
        summary: "Rename Milk.",
        changes: [
          {
            collection: "items",
            id: "i-1",
            before: { title: "Milk" },
            after: { title: "Oat milk" },
          },
        ],
      });
    const result = await carryOut("mixed", candidate.workspaceId, mixed.fake);
    expect(result.dataOffer?.interfaceMessage).toContain("was updated");
    expect(
      withInterfaceOutcome(
        result.dataOffer?.interfaceMessage,
        dataOutcome({ kind: "answer", answer: "data_cancelled" }),
      ).message,
    ).toContain(
      "was updated. A list to tick off at the store. The proposed changes were cancelled.",
    );
    mixed.fake.finishData = () => Promise.reject(new Error("Lost response"));
    const uncertain = await carryOut("mixed", candidate.workspaceId, mixed.fake);
    expect(uncertain.reloadData).toBe(true);
    expect(uncertain.message).toContain("was updated");
    expect(uncertain.message).toContain("couldn't be confirmed");
    expect(uncertain.message).not.toContain("weren't applied");
  });
  it("GEN-07, GEN-08: an edit says updated only after activation; unchanged/stale never stage", async () => {
    const updated = deps(
      { ...candidate, operation: "edit" },
      { outcome: "activated", workspace: {} as never, migrationCount: 1 },
    );
    expect(await carryOut("Add quantities", candidate.workspaceId, updated.fake)).toMatchObject({
      message: "Shopping list was updated. A list to tick off at the store.",
      openWorkspaceId: candidate.workspaceId,
    });
    for (const answer of ["unchanged", "stale"] as const) {
      const untouched = deps({ kind: "answer", answer });
      expect((await carryOut("x", null, untouched.fake)).message).toBe(
        en[answer === "unchanged" ? "request.unchanged" : "request.stale"],
      );
      expect(untouched.seen.stagings).toHaveLength(0);
    }
  });
  it("GEN-09: stages a smoke repair once, reports its own outcome, and never repairs a cancellation or refusal", async () => {
    const { fake, seen } = deps(candidate);
    const repair = vi
      .fn()
      .mockResolvedValue({ ...candidate, hash: "b".repeat(64), name: "Fixed list" });
    fake.repairSmoke = repair;
    let attempts = 0;
    fake.stage = (options) => {
      seen.stagings.push(options);
      return Promise.resolve<StagingResult>(
        ++attempts === 1
          ? { outcome: "check-failed", check: "smoke", reason: "2 fields have no label." }
          : { outcome: "activated", workspace: {} as never, migrationCount: 0 },
      );
    };
    expect(await carryOut("A list", null, fake)).toMatchObject({
      message: "Fixed list is ready. A list to tick off at the store.",
    });
    expect(repair).toHaveBeenCalledWith({
      workspaceId: candidate.workspaceId,
      hash: candidate.hash,
      findings: ["2 fields have no label."],
    });
    expect(seen.stagings.map((s) => s.candidate.hash)).toEqual([candidate.hash, "b".repeat(64)]);
    fake.stage = () =>
      Promise.resolve({ outcome: "check-failed", check: "smoke", reason: "Still broken" });
    repair.mockClear();
    expect(await carryOut("A list", null, fake)).toEqual({ message: en["request.checkFailed"] });
    expect(repair).toHaveBeenCalledTimes(1);
    fake.stage = () =>
      Promise.resolve({ outcome: "check-failed", check: "cancelled", reason: "Cancelled" });
    repair.mockClear();
    await carryOut("A list", null, fake);
    expect(repair).not.toHaveBeenCalled();
    fake.stage = () =>
      Promise.resolve({
        outcome: "check-failed",
        check: "start",
        reason: "Could not start",
      });
    repair.mockResolvedValue({
      kind: "failed",
      failure: "provider",
      message: "The request was stopped.",
      findings: [],
    });
    expect(await carryOut("A list", null, fake)).toEqual({
      message: "That didn't work. The request was stopped.",
    });
  });
  it("RUN-03, VER-02: a candidate is staged behind the smoke check, and only an activated one is called ready", async () => {
    const { fake, seen } = deps(candidate, {
      outcome: "activated",
      workspace: {} as never,
      migrationCount: 0,
    });
    expect(await carryOut("A shopping list", null, fake)).toEqual({
      message: "Shopping list is ready. A list to tick off at the store.",
      openWorkspaceId: candidate.kind === "candidate" ? candidate.workspaceId : "",
    });
    expect(seen.requests).toEqual([{ request: "A shopping list" }]);
    expect(seen.stagings).toHaveLength(1);
    expect(seen.stagings[0]).toMatchObject({
      candidate: { mountId: `v-${"a".repeat(64)}`, syntheticData: { items: [] } },
      expectedDataRevision: 1,
    });
    expect(seen.stagings[0]!.checks.map((check) => check.name)).toEqual(["smoke"]);
  });

  it("GEN-08: a candidate that fails its check, or is refused, is never called ready, and nothing opens", async () => {
    const failed = deps(candidate, { outcome: "check-failed", check: "smoke", reason: "x" });
    expect(await carryOut("x", null, failed.fake)).toEqual({ message: en["request.checkFailed"] });
    const refused = deps(candidate, { outcome: "refused", reason: "stale", message: "it changed" });
    expect(await carryOut("x", null, refused.fake)).toEqual({
      message: "The tool couldn't be put in place: it changed",
    });
  });

  it("GEN-01: the open workspace goes with the request", async () => {
    const { fake, seen } = deps({ kind: "answer", answer: "clarify" });
    await carryOut("Make it calmer", "00000000-0000-4000-8000-000000000002", fake);
    expect(seen.requests).toEqual([
      { request: "Make it calmer", workspaceId: "00000000-0000-4000-8000-000000000002" },
    ]);
  });

  it("GEN-08: every answer and failure is said in plain words, with nothing staged", async () => {
    const cases: [GenerateReply, string][] = [
      [{ kind: "answer", answer: "clarify" }, en["request.clarify"]],
      [{ kind: "answer", answer: "unsupported" }, en["request.unsupported"]],
      [
        { kind: "answer", answer: "cannot", reason: "Booking needs the internet." },
        "Tessera can't make that. Booking needs the internet.",
      ],
      [{ kind: "answer", answer: "ask_to_split" }, en["request.split"]],
      [{ kind: "answer", answer: "not_yet" }, en["request.notYet"]],
      [
        {
          kind: "failed",
          failure: "provider",
          message: "Claude Code isn't signed in.",
          findings: [],
        },
        "That didn't work. Claude Code isn't signed in.",
      ],
    ];
    for (const [reply, message] of cases) {
      const { fake, seen } = deps(reply);
      expect(await carryOut("x", null, fake)).toEqual({ message });
      expect(seen.stagings).toEqual([]);
    }
    const saved = deps({ kind: "open_saved", savedToolId: "t-1" });
    // GEN-18: a matched saved tool is handed to the app to offer, never opened here.
    expect(await carryOut("x", null, saved.fake)).toEqual({ message: "", savedToolId: "t-1" });
    expect(saved.seen.stagings).toEqual([]);
  });
});
