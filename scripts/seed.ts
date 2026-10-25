// Docs: docs/code/scripts/dev-data.md
// `pnpm seed [folder]`: fills a development data folder with hand-written tools, so every screen of
// the host app has something to show before tools can be generated (M2). It never touches the real
// user data folder (ENG-19), and refuses while Tessera runs on the folder.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Artifact, Migration } from "../packages/contracts/src/index.ts";
import { LOCK_FILE } from "../packages/server/src/launcher/index.ts";
import {
  openDataFolder,
  tryLockFile,
  type DataFolder,
} from "../packages/server/src/storage/index.ts";
import { deleteWorkspace } from "../packages/server/src/trash/index.ts";
import { saveVersion } from "../packages/server/src/versions/index.ts";
import {
  activateVersion,
  createWorkspace,
  getWorkspace,
  listWorkspaces,
  patchWorkspaceData,
  readWorkspaceData,
  saveTool,
} from "../packages/server/src/workspaces/index.ts";
import { devFolder } from "./dev-data.ts";

type Item = Record<string, unknown>;
const listSchema = (properties: object) =>
  ({
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          required: ["id", "title"],
          properties: { id: { type: "string" }, title: { type: "string" }, ...properties },
          additionalProperties: false,
        },
      },
    },
  }) as Artifact["data"]["schema"];

/**
 * A list tool: add an item, remove one, and, when `checks` is on, tick it off. Its data is
 * `items`, each with a title (and `done`), saved through the bridge (RUN-04).
 */
function listTool(heading: string, label: string, checks: boolean): Artifact["code"] {
  // No <form>: a tool's frame allows scripts only, so a form never submits. The button and the
  // Enter key add instead.
  return {
    html: `<h1>${heading}</h1>
<p><label for="item">${label}</label> <input id="item" autocomplete="off" /> <button id="add" type="button">Add</button></p>
<p id="status" role="status"></p>
<ul id="list"></ul>
<p id="empty">Nothing here yet.</p>`,
    css: "ul { padding: 0; list-style: none; } li { display: flex; gap: 8px; align-items: center; margin: 4px 0; }",
    js: `const list = document.getElementById("list");
const empty = document.getElementById("empty");
const status = document.getElementById("status");
const input = document.getElementById("item");
let revisions = {};
async function load() {
  const read = await tessera.call("data.read");
  revisions = read.revisions.items ?? {};
  const items = read.data.items ?? [];
  empty.hidden = items.length > 0;
  list.replaceChildren(...items.map((item) => {
    const li = document.createElement("li");
    const label = document.createElement("label");
    ${
      checks
        ? `const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = item.done === true;
    box.addEventListener("change", () => change([{ op: "replace", collection: "items", id: item.id, revisionCount: revisions[item.id], fields: { done: box.checked } }]));
    label.append(box, " ", item.title);`
        : `label.append(item.title);`
    }
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Remove";
    remove.setAttribute("aria-label", "Remove " + item.title);
    remove.addEventListener("click", () => change([{ op: "remove", collection: "items", id: item.id, revisionCount: revisions[item.id] }]));
    li.append(label, remove);
    return li;
  }));
}
async function change(operations) {
  // A refused change, such as one made against an older copy, says so; what is saved shows either way.
  try {
    await tessera.call("data.patch", { operations });
    status.textContent = "";
  } catch (error) {
    status.textContent = error.message;
  }
  await load();
}
function add() {
  const title = input.value.trim();
  if (!title) return;
  input.value = "";
  change([{ op: "add", collection: "items", record: ${checks ? "{ title, done: false }" : "{ title }"} }]);
}
document.getElementById("add").addEventListener("click", add);
input.addEventListener("keydown", (event) => {
  if (event.key === "Enter") add();
});
load();`,
  };
}

const tool = (code: Artifact["code"], data: Partial<Artifact["data"]> = {}): Artifact => ({
  contractVersion: 2,
  code,
  data: {
    schemaVersion: 1,
    schema: listSchema({}),
    defaults: { items: [] },
    migrations: [],
    ...data,
  },
  capabilities: [],
  pins: [],
  ui: { standardVersion: 1, mode: "standard" },
});

const withDone: Migration = {
  fromVersion: 1,
  toVersion: 2,
  operations: [{ op: "addField", collection: "items", fields: { done: false } }],
};

/** Makes a workspace run each tool in turn; returns its ID. */
function workspaceThrough(folder: DataFolder, title: string, ...tools: Artifact[]): string {
  const { id } = createWorkspace(folder, title);
  for (const artifact of tools) {
    const revision = getWorkspace(folder, id)!.dataRevision;
    const result = activateVersion(folder, id, saveVersion(folder.db, artifact), revision);
    if (!result.ok) throw new Error(result.message);
  }
  return id;
}

/** Adds items as the tool would, one change each, so each can be undone. */
function add(folder: DataFolder, id: string, ...items: Item[]) {
  for (const record of items) {
    const result = patchWorkspaceData(folder, id, {
      operations: [{ op: "add", collection: "items", record }],
    });
    if (!result.ok) throw new Error(result.message);
  }
}

/** Fills an empty data folder with the sample workspaces; the browser tests use it too. */
export function seedSamples(folder: DataFolder): void {
  // A shopping list that went from version 1 to version 2, which added ticking items off: its
  // history has a restore to show, and restoring version 1 would lose what was ticked.
  const shopping = workspaceThrough(
    folder,
    "Shopping list",
    tool(listTool("Shopping list", "Item", false)),
  );
  add(folder, shopping, { title: "Milk" }, { title: "Bread" });
  const v2 = tool(listTool("Shopping list", "Item", true), {
    schemaVersion: 2,
    schema: listSchema({ done: { type: "boolean" } }),
    migrations: [withDone],
  });
  const revision = getWorkspace(folder, shopping)!.dataRevision;
  const upgraded = activateVersion(folder, shopping, saveVersion(folder.db, v2), revision);
  if (!upgraded.ok) throw new Error(upgraded.message);
  add(folder, shopping, { title: "Eggs", done: false });
  const { revisions } = readWorkspaceData(folder, shopping);
  const milk = Object.keys(revisions["items"] ?? {})[0]!;
  patchWorkspaceData(folder, shopping, {
    operations: [
      {
        op: "replace",
        collection: "items",
        id: milk,
        revisionCount: revisions["items"]![milk]!,
        fields: { done: true },
      },
    ],
  });

  // Garden notes, saved to my tools, so the library has an entry to continue or use again.
  const garden = workspaceThrough(
    folder,
    "Garden notes",
    tool(listTool("Garden notes", "Note", false)),
  );
  add(folder, garden, { title: "Water the tomatoes" }, { title: "Plant the basil" });
  saveTool(folder, garden, "Garden journal");

  // An old list in the trash, to restore or empty.
  deleteWorkspace(
    folder,
    workspaceThrough(folder, "Old packing list", tool(listTool("Packing list", "Thing", false))),
  );

  // A workspace without a tool, as a new one is before the chat makes its first tool (M2).
  createWorkspace(folder, "Ideas");
}

// Run as a command, not when a test imports seedSamples.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main(process.argv[2]);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

async function main(given: string | undefined) {
  const target = devFolder(given);
  fs.mkdirSync(target, { recursive: true });
  const lock = tryLockFile(path.join(target, LOCK_FILE));
  if (!lock) throw new Error(`Tessera is running on ${target}. Close it first, then seed again.`);
  const folder = await openDataFolder(target);
  try {
    if (listWorkspaces(folder).length > 0) {
      throw new Error(
        `${target} already has workspaces. To start again, close Tessera, delete that folder and seed again.`,
      );
    }
    seedSamples(folder);
    console.log(
      `Seeded ${target}. Start Tessera on it with: pnpm dev${given ? ` "${given}"` : ""}`,
    );
  } finally {
    folder.close();
    lock.release();
  }
}
