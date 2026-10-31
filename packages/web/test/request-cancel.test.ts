import { expect, it, vi } from "vitest";
import type { GenerateReply } from "@tessera/contracts";
import { RequestControl } from "../src/request-control.ts";
import { carryOut, type RequestDeps } from "../src/generate.ts";
import { HostError } from "../src/host-api.ts";
import { en } from "../src/i18n/en.ts";

const token = "00000000-0000-4000-8000-000000000001";
const candidate: Extract<GenerateReply, { kind: "candidate" }> = {
  kind: "candidate",
  operation: "edit",
  workspaceId: token,
  hash: "a".repeat(64),
  mountId: "test",
  capabilities: [],
  syntheticData: {},
  expectedDataRevision: 0,
  activation: { token, expiresAt: Date.now() + 420_000 },
  name: "List",
  summary: "Made it dark.",
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function control() {
  const calls: string[] = [];
  const owner = new RequestControl((url) => {
    calls.push(String(url));
    return Promise.resolve(
      Response.json(String(url).endsWith("register") ? { token } : { cancelled: true }),
    );
  });
  return { owner, calls };
}
function deps(): RequestDeps {
  return {
    generate: vi.fn(() => Promise.resolve(candidate)),
    repairSmoke: vi.fn(() => Promise.resolve(candidate)),
    finishData: vi.fn<RequestDeps["finishData"]>(() =>
      Promise.resolve({ kind: "answer", answer: "data_unchanged" }),
    ),
    stage: vi.fn<RequestDeps["stage"]>(() =>
      Promise.resolve({ outcome: "activated", workspace: {} as never, migrationCount: 0 }),
    ),
  };
}

it("CLI-06: cancellation during registration cancels the returned capability and sends no generation", async () => {
  const registration = deferred<Response>();
  const routes: string[] = [];
  const owner = new RequestControl((url) => {
    routes.push(String(url));
    return String(url).endsWith("register")
      ? registration.promise
      : Promise.resolve(Response.json({ cancelled: true }));
  });
  const fake = deps();
  const pending = carryOut("A list", null, fake, undefined, owner);
  await owner.cancel();
  registration.resolve(Response.json({ token }));
  expect(await pending).toEqual({ message: en["request.stopped"] });
  expect(routes).toEqual(["/api/generate/register", "/api/generate/cancel"]);
  expect(fake.generate).not.toHaveBeenCalled();
});
it.each(["queued", "running", "repair"])(
  "CLI-06: cancellation while %s never stages the late candidate",
  async (mode) => {
    const { owner } = control();
    const fake = deps();
    const reply = deferred<GenerateReply>();
    const entered = deferred<void>();
    if (mode === "repair") {
      fake.stage = vi.fn<RequestDeps["stage"]>(() =>
        Promise.resolve({ outcome: "check-failed", check: "smoke", reason: "Missing label" }),
      );
      fake.repairSmoke = () => {
        entered.resolve();
        return reply.promise;
      };
    } else
      fake.generate = () => {
        entered.resolve();
        return reply.promise;
      };
    const pending = carryOut("A list", null, fake, undefined, owner);
    await entered.promise;
    await owner.cancel();
    reply.resolve(candidate);
    expect(await pending).toEqual({ message: en["request.stopped"] });
    expect(fake.stage).toHaveBeenCalledTimes(mode === "repair" ? 1 : 0);
  },
);
it.each(["generate", "repair"])(
  "GEN-08: a %s refusal confirming the stop before any job reports it stopped",
  async (mode) => {
    const { owner } = control();
    const fake = deps();
    const refusal = deferred<void>();
    const entered = deferred<void>();
    const refuse = async (): Promise<GenerateReply> => {
      entered.resolve();
      await refusal.promise;
      throw new HostError("The request was stopped or expired. Please ask again.", 409);
    };
    if (mode === "repair") {
      fake.stage = vi.fn<RequestDeps["stage"]>(() =>
        Promise.resolve({ outcome: "check-failed", check: "smoke", reason: "Missing label" }),
      );
      fake.repairSmoke = refuse;
    } else fake.generate = refuse;
    const pending = carryOut("A list", null, fake, undefined, owner);
    await entered.promise;
    await owner.cancel();
    refusal.resolve();
    expect(await pending).toEqual({ message: en["request.stopped"] });
  },
);
it("GEN-08: a refused entry plan after Cancel keeps the applied interface and says it stopped", async () => {
  const { owner } = control();
  const fake = deps();
  fake.generate = () => Promise.resolve({ ...candidate, dataPending: true });
  fake.finishData = async () => {
    await owner.cancel();
    throw new HostError("The request was stopped or expired. Please ask again.", 409);
  };
  const result = await carryOut("Make it dark and add milk", token, fake, undefined, owner);
  expect(result.openWorkspaceId).toBe(token);
  expect(result.message).toContain("Made it dark.");
  expect(result.message).toContain(en["request.stopped"]);
  expect(result.reloadData).toBeUndefined();
});
it("GEN-08: any other failure after Cancel stays uncertain", async () => {
  const { owner } = control();
  const fake = deps();
  fake.generate = async () => {
    await owner.cancel();
    throw new HostError(en["request.failedPlain"], 500);
  };
  expect(await carryOut("A list", null, fake, undefined, owner)).toEqual({
    message: en["request.requestUnknown"],
    reloadData: true,
  });
});
it("CLI-06 RUN-03: cancelling staging aborts its signal and never repairs", async () => {
  const { owner } = control();
  const fake = deps();
  const entered = deferred<void>();
  fake.stage = (options) =>
    new Promise((resolve) => {
      entered.resolve();
      options.signal!.addEventListener(
        "abort",
        () => resolve({ outcome: "check-failed", check: "start", reason: "Cancelled" }),
        { once: true },
      );
    });
  const pending = carryOut("A list", null, fake, undefined, owner);
  await entered.promise;
  await owner.cancel();
  expect(await pending).toEqual({ message: en["request.stopped"] });
  expect(fake.repairSmoke).not.toHaveBeenCalled();
});
it("GEN-08: a confirmed late activation remains applied, with pending entries stopped", async () => {
  const { owner } = control();
  const fake = deps();
  fake.generate = () => Promise.resolve({ ...candidate, dataPending: true });
  fake.stage = async () => {
    await owner.cancel();
    return { outcome: "activated", workspace: {} as never, migrationCount: 0 };
  };
  const result = await carryOut("Make it dark and add milk", token, fake, undefined, owner);
  expect(result.openWorkspaceId).toBe(token);
  expect(result.message).toContain("Made it dark.");
  expect(result.message).toContain(en["request.stopped"]);
  expect(fake.finishData).not.toHaveBeenCalled();
});
it("GEN-08 DATA-02: a committed data reply remains successful after cancellation", async () => {
  const { owner } = control();
  const fake = deps();
  fake.generate = async (request) => {
    expect(request.controlToken).toBe(token);
    await owner.cancel();
    return {
      kind: "data_changed",
      workspaceId: token,
      name: "List",
      count: 1,
      summary: "Added milk.",
    };
  };
  expect(await carryOut("Add milk", token, fake, undefined, owner)).toMatchObject({
    dataChanged: true,
    openWorkspaceId: token,
  });
});
it("GEN-08: cancellation bounds a lost response without aborting the data request", async () => {
  vi.useFakeTimers();
  try {
    const { owner } = control();
    await owner.start();
    const lost = deferred<string>();
    const result = owner.wait(lost.promise);
    const assertion = expect(result).rejects.toThrow("unknown");
    await owner.cancel();
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
    lost.resolve("Committed");
    expect(await lost.promise).toBe("Committed");
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
it("CLI-06: one request's cancellation never uses another request's capability", async () => {
  const first = control();
  const second = control();
  await first.owner.start();
  await second.owner.start();
  await first.owner.cancel();
  expect(first.calls).toContain("/api/generate/cancel");
  expect(second.calls).toEqual(["/api/generate/register"]);
  expect(second.owner.stopped).toBe(false);
});

it("GEN-08: a late mixed review after Cancel retains interface facts and discards the proposal", async () => {
  const { owner } = control();
  const fake = deps();
  fake.generate = async () => {
    await owner.cancel();
    return {
      kind: "mixed_data",
      workspaceId: token,
      name: "List",
      interface: { outcome: "updated", summary: "Made it dark." },
      data: {
        kind: "data_confirmation",
        workspaceId: token,
        name: "List",
        token,
        summary: "Replace milk.",
        changes: [
          { collection: "items", id: "one", before: { title: "Milk" }, after: { title: "Bread" } },
        ],
      },
    };
  };
  const result = await carryOut("Make it dark and replace milk", token, fake, undefined, owner);
  expect(result.dataOffer).toBeUndefined();
  expect(result.message).toContain("Made it dark.");
  expect(result.message).toContain(en["request.stopped"]);
});
it("GEN-08: a committed mixed data continuation after Cancel keeps both success facts", async () => {
  const { owner } = control();
  const fake = deps();
  fake.generate = () => Promise.resolve({ ...candidate, dataPending: true });
  fake.finishData = async () => {
    await owner.cancel();
    return {
      kind: "data_changed",
      workspaceId: token,
      name: "List",
      count: 1,
      summary: "Added milk.",
    };
  };
  const result = await carryOut("Make it dark and add milk", token, fake, undefined, owner);
  expect(result.dataChanged).toBe(true);
  expect(result.message).toContain("Made it dark.");
  expect(result.message).toContain("Added milk.");
});
it("GEN-08: a lost initial response after Cancel says uncertain and reloads rather than unchanged", async () => {
  const { owner } = control();
  const fake = deps();
  fake.generate = async () => {
    await owner.cancel();
    throw new Error("Lost response after entry commit");
  };
  expect(await carryOut("Add milk", token, fake, undefined, owner)).toEqual({
    message: en["request.requestUnknown"],
    reloadData: true,
  });
});
it("CLI-06 GEN-08: an unreachable cancellation endpoint aborts staging locally but never claims host confirmation", async () => {
  const owner = new RequestControl((url) =>
    String(url).endsWith("register")
      ? Promise.resolve(Response.json({ token }))
      : Promise.reject(new Error("Offline")),
  );
  await owner.start();
  await expect(owner.cancel()).rejects.toThrow("Offline");
  expect(owner.stopped).toBe(true);
});
