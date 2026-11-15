import type { BridgeArgs } from "@tessera/contracts";
import type { DataHandlers, RuntimeState, ToolRuntime } from "@tessera/runtime";
import { BridgeError, serveBridge, serverData } from "@tessera/runtime";
import { ask } from "./host-api.ts";

// Starting the open workspace's tool, and remembering how the person left it (RUN-02, UX-07).

export type StartDeps = {
  ask: typeof ask;
  serveBridge: typeof serveBridge;
  serverData: typeof serverData;
};
const defaults: StartDeps = { ask, serveBridge, serverData };

/** What the panel hears about the running tool. */
export type StartOptions = {
  /** Called after each change the tool saved to its data, so the history can show it (APP-05). */
  onWrite?: () => void;
  /**
   * Asks the person whether the tool may change things through a connection, the first time it
   * tries (ADR 0015 point 4, A70); resolves true if they allow it. Without it, nothing is allowed.
   */
  askToWrite?: (question: WriteQuestion) => Promise<boolean>;
  /**
   * Called once a permission the person gave is kept, and after each request through a connection
   * settles, so open details show the permission and the request (A72, A73).
   */
  onConnectionUsed?: () => void;
};

/** What the person is asked before a tool's first change through a connection (A70). */
export type WriteQuestion = {
  /** The tool's name. */
  tool: string;
  connection: string;
  method: BridgeArgs<"connection.request">["method"];
  /** Where it goes: the connection's address and the tool's path, never the key. */
  address: string;
  /** The text it sends, if any. */
  body: string | null;
};

const DECLINED = "The person didn't allow this change. Nothing was sent.";

/**
 * The connection handler with the person's permission asked for (A70): a change the server refuses
 * as needing it is put to the person, once per connection at a time, and on their leave allowed
 * for this workspace and sent again; otherwise the tool hears it wasn't allowed. Nothing else is
 * asked or retried, and the server stays the one that decides (CNX-07).
 */
export function withPermission(
  connection: NonNullable<DataHandlers["connection"]>,
  workspaceId: string,
  tool: string,
  askToWrite: StartOptions["askToWrite"],
  deps: Pick<StartDeps, "ask">,
  onConnectionUsed?: StartOptions["onConnectionUsed"],
): NonNullable<DataHandlers["connection"]> {
  // One question per connection at a time: changes that wait on it share its answer.
  const asking = new Map<string, Promise<boolean>>();
  const decide = async (args: BridgeArgs<"connection.request">): Promise<boolean> => {
    if (!askToWrite) return false;
    const { connections } = await deps.ask("connections.list", {});
    const found = connections.find((c) => c.name === args.connection);
    if (!found) return false;
    const origin = args.origin ?? found.origins[0]!;
    const allowed = await askToWrite({
      tool,
      connection: args.connection,
      method: args.method,
      address: `${origin}${args.path}`,
      body: args.body ?? null,
    });
    if (allowed) {
      await deps.ask("connections.allowWrites", { workspaceId, connection: args.connection });
      onConnectionUsed?.();
    }
    return allowed;
  };
  const request: NonNullable<DataHandlers["connection"]> = async (args, context) => {
    try {
      return await connection(args, context);
    } catch (error) {
      if (!(error instanceof BridgeError) || error.code !== "needs-permission") throw error;
      let answer = asking.get(args.connection);
      if (!answer) {
        answer = decide(args).finally(() => asking.delete(args.connection));
        asking.set(args.connection, answer);
      }
      if (!(await answer)) throw new BridgeError("not-allowed", DECLINED);
      return connection(args, context);
    }
  };
  // Each request settled, however it ended, is in the server's record for the details (A73).
  return (args, context) => request(args, context).finally(() => onConnectionUsed?.());
}

/**
 * Starts the tool through `open` (a first start or a restore) and serves it the bridge with what
 * its version declares. Nothing more happens once `signal` is aborted, at whichever step it is:
 * a panel closed while the server answered never opens a tool it can no longer close (RUN-02).
 * Resolves true if the tool now runs.
 */
export async function startTool(
  runtime: ToolRuntime,
  workspaceId: string,
  open: (runtime: ToolRuntime) => ReturnType<ToolRuntime["open"]>,
  signal: AbortSignal,
  { onWrite, askToWrite, onConnectionUsed }: StartOptions = {},
  deps: StartDeps = defaults,
): Promise<boolean> {
  const { workspace, capabilities } = await deps.ask("workspaces.open", { id: workspaceId });
  if (signal.aborted) return false;
  const tool = await open(runtime);
  if (signal.aborted) return false;
  const data = deps.serverData(workspaceId);
  deps.serveBridge(tool, {
    capabilities,
    data: {
      ...data,
      patch: async (batch, context) => {
        const result = await data.patch(batch, context);
        onWrite?.();
        return result;
      },
      ...(data.connection
        ? {
            connection: withPermission(
              (args, context) => data.connection!(args, context),
              workspaceId,
              workspace.title,
              askToWrite,
              deps,
              onConnectionUsed,
            ),
          }
        : {}),
      // An image through one is a read, so it never asks; once settled it is in the record (A75).
      ...(data.connectionImage
        ? {
            connectionImage: (args, context) =>
              data.connectionImage!(args, context).finally(() => onConnectionUsed?.()),
          }
        : {}),
    },
  });
  return true;
}

// How each workspace's tool was left, for this tab: minimized and stopped tools stay so after a
// reload or a switch away and back (UX-07). Storage can be off; then nothing is remembered.
const key = (workspaceId: string) => `tessera.tool.${workspaceId}`;

export function rememberedState(workspaceId: string): RuntimeState | undefined {
  try {
    const raw = sessionStorage.getItem(key(workspaceId));
    const state = raw ? (JSON.parse(raw) as RuntimeState) : undefined;
    return state && state.mode !== "empty" && "mountId" in state && state.mountId === workspaceId
      ? state
      : undefined;
  } catch {
    return undefined;
  }
}

export function rememberState(workspaceId: string, state: RuntimeState): void {
  try {
    sessionStorage.setItem(key(workspaceId), JSON.stringify(state));
  } catch {
    // Nothing to do: the tool just won't be remembered.
  }
}
