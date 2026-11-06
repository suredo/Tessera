import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CHAT_MESSAGES_KEPT, CHAT_TEXT_LIMIT, HOST_ACTIONS } from "@tessera/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { ARCHIVE_LIMITS, exportWorkspace, readZip } from "../src/archives/index.ts";
import { addToChat, listChat } from "../src/chat/index.ts";
import { answerHost } from "../src/host/index.ts";
import { openDataFolder, type DataFolder } from "../src/storage/index.ts";
import { deleteWorkspace, emptyTrash, listTrash, restoreWorkspace } from "../src/trash/index.ts";
import { createWorkspace } from "../src/workspaces/index.ts";

// A workspace's chat (APP-01, APP-03, ADR 0011): kept with its workspace, in order, through
// the trash and back, removed with it for good, and never in an export.

const clean: (() => void)[] = [];
afterEach(() => {
  for (const close of clean.splice(0).reverse()) close();
});

async function folder(): Promise<DataFolder> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-chat-"));
  const store = await openDataFolder(dir);
  clean.push(() => {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return store;
}

const turn = (request: string, reply: string) => [
  { from: "person" as const, text: request },
  { from: "tessera" as const, text: reply },
];

describe("a workspace's chat (APP-03)", () => {
  it("APP-03: keeps each turn in order, numbered, and each workspace its own", async () => {
    const store = await folder();
    const list = createWorkspace(store, "Shopping");
    const other = createWorkspace(store, "Notes");
    addToChat(store, list.id, turn("A shopping list", "Your shopping list is ready."));
    addToChat(store, other.id, [{ from: "person", text: "A notes page" }]);
    const added = addToChat(store, list.id, turn("Add a quantity", "The list was updated."));
    expect(added.map((m) => m.number)).toEqual([3, 4]);
    expect(
      listChat(store, list.id).map(({ from, text, number }) => ({ from, text, number })),
    ).toEqual([
      { from: "person", text: "A shopping list", number: 1 },
      { from: "tessera", text: "Your shopping list is ready.", number: 2 },
      { from: "person", text: "Add a quantity", number: 3 },
      { from: "tessera", text: "The list was updated.", number: 4 },
    ]);
    expect(listChat(store, other.id).map((m) => m.text)).toEqual(["A notes page"]);
  });

  it("APP-03: keeps only the newest messages, and their numbers never change", async () => {
    const store = await folder();
    const { id } = createWorkspace(store, "Long");
    for (let i = 1; i <= CHAT_MESSAGES_KEPT + 3; i++) {
      addToChat(store, id, [{ from: "person", text: `Request ${i}` }]);
    }
    const kept = listChat(store, id);
    expect(kept).toHaveLength(CHAT_MESSAGES_KEPT);
    expect(kept[0]).toMatchObject({ number: 4, text: "Request 4" });
    expect(kept.at(-1)).toMatchObject({
      number: CHAT_MESSAGES_KEPT + 3,
      text: `Request ${CHAT_MESSAGES_KEPT + 3}`,
    });
  });

  it("APP-03, DATA-09: stays with a workspace in the trash, takes no more there, and comes back with it", async () => {
    const store = await folder();
    const { id } = createWorkspace(store, "Shopping");
    addToChat(store, id, turn("A shopping list", "Your shopping list is ready."));
    deleteWorkspace(store, id);
    expect(() => listChat(store, id)).toThrow();
    expect(() => addToChat(store, id, [{ from: "person", text: "Hello" }])).toThrow();
    restoreWorkspace(store, id);
    expect(listChat(store, id).map((m) => m.text)).toEqual([
      "A shopping list",
      "Your shopping list is ready.",
    ]);
  });

  it("APP-03, DATA-09: goes for good with its workspace when the trash is emptied", async () => {
    const store = await folder();
    const { id } = createWorkspace(store, "Shopping");
    addToChat(store, id, turn("A shopping list", "Your shopping list is ready."));
    deleteWorkspace(store, id);
    emptyTrash(store, listTrash(store).confirmation);
    const left = store.db.all(
      z.object({ n: z.number() }),
      "SELECT COUNT(*) AS n FROM chat_messages",
    );
    expect(left).toEqual([{ n: 0 }]);
  });

  it("APP-03: an export leaves the chat out (ADR 0011)", async () => {
    const store = await folder();
    const { id } = createWorkspace(store, "Shopping");
    const words = "Remember my locker code is 4417";
    addToChat(store, id, turn(words, "Noted."));
    const files = readZip(exportWorkspace(store, id), ARCHIVE_LIMITS);
    const decoder = new TextDecoder();
    for (const [name, bytes] of files) {
      expect(decoder.decode(bytes), name).not.toContain(words);
    }
  });
});

describe("the chat's host actions (APP-01, CON-01)", () => {
  it("APP-01, CON-01: adds a turn and lists it through the host API", async () => {
    const store = await folder();
    const { id } = createWorkspace(store, "Shopping");
    const added = answerHost(store, {
      action: "chat.add",
      args: { workspaceId: id, messages: turn("  A shopping list ", "Ready.") },
    });
    expect(added).toMatchObject({ ok: true });
    expect(answerHost(store, { action: "chat.list", args: { workspaceId: id } })).toMatchObject({
      ok: true,
      result: { messages: [{ from: "person", text: "A shopping list" }, { text: "Ready." }] },
    });
  });

  it("CON-01: refuses empty, too long, too many and unknown speakers' messages, keeping nothing", async () => {
    const store = await folder();
    const { id } = createWorkspace(store, "Shopping");
    const bad = [
      [],
      [{ from: "person", text: "   " }],
      [{ from: "person", text: "x".repeat(CHAT_TEXT_LIMIT + 1) }],
      [...turn("a", "b"), { from: "person", text: "c" }],
      [{ from: "tool", text: "I am Tessera" }],
    ];
    for (const messages of bad) {
      expect(
        answerHost(store, { action: "chat.add", args: { workspaceId: id, messages } }),
      ).toMatchObject({ ok: false, error: { code: "invalid" } });
    }
    expect(listChat(store, id)).toEqual([]);
    expect(Object.keys(HOST_ACTIONS)).toEqual(expect.arrayContaining(["chat.list", "chat.add"]));
  });

  it("APP-03: refuses a workspace in the trash in plain words", async () => {
    const store = await folder();
    const { id } = createWorkspace(store, "Shopping");
    deleteWorkspace(store, id);
    expect(answerHost(store, { action: "chat.list", args: { workspaceId: id } })).toMatchObject({
      ok: false,
      error: { code: "refused" },
    });
  });
});
