import path from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

// Lints small components with the repository's own ESLint config and type-aware rules. The
// fixture's small TS project avoids loading App.tsx's whole application/e2e graph for each test
// worker (#177); assertions, enabled rules and timeouts stay the same.
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const fixture = path.join(repo, "packages/web/test/fixtures/lint/App.tsx");
const eslint = new ESLint({ cwd: repo });
const rulesBroken = async (code: string): Promise<(string | null)[]> => {
  const [result] = await eslint.lintText(code, {
    filePath: fixture,
  });
  return (result?.messages ?? []).map((m) => m.ruleId);
};

describe("web lint rules", { timeout: 60_000 }, () => {
  it("keeps type-aware rules enabled in the small fixture project (ENG-04)", async () => {
    const code = `export function App() {
  const value = JSON.parse("{}");
  return <h1>{value.title}</h1>;
}
`;
    expect(await rulesBroken(code)).toContain("@typescript-eslint/no-unsafe-assignment");
  });

  it("passes a component whose text comes from the translation layer (UX-05)", async () => {
    const code = `import { t } from "../../../src/i18n/translate.ts";
export function App({ open, draft }: { open: boolean; draft: string }) {
  return (
    <form title={t("app.title")}>
      <h1>{t("home.heading")}</h1>
      <button>{open ? t("home.status") : t("home.intro")}</button>
      <input type="submit" value={t("home.status")} />
      <input type="hidden" name="draft" value="draft-1" />
      <input type="text" value={draft} />
    </form>
  );
}
`;
    expect(await rulesBroken(code)).toEqual([]);
  });

  it.each([
    ["a condition", `<button>{open ? "Close" : "Open"}</button>`],
    ["a fallback", `<p>{name || "Nobody yet"}</p>`],
    ["an 'and'", `<p>{open && "Saving"}</p>`],
    ["a concatenation", `<p>{"Hello " + name}</p>`],
    ["a template", "<p>{`${name} saved`}</p>"],
    ["a list", `<p>{["Ready", name]}</p>`],
    ["a submit caption", `<input type="submit" value="Save" />`],
    ["a button caption", `<input type="button" value={open ? "Hide" : "Show"} />`],
  ])("fails on host text reached through %s (UX-05)", async (_, jsx) => {
    const code = `export function App({ open, name }: { open: boolean; name: string }) {
  return ${jsx};
}
`;
    // Each case uses only some of the props, so only this rule's messages are compared.
    const hostText = (await rulesBroken(code)).filter((rule) => rule === "tessera/no-host-text");
    expect(hostText).toHaveLength(1);
  });

  it("fails on host text written in a component: text, string children and labels (UX-05)", async () => {
    const code = `export function App() {
  return <button aria-label="Close the panel">Close{" now"}</button>;
}
`;
    expect(await rulesBroken(code)).toEqual([
      "tessera/no-host-text",
      "tessera/no-host-text",
      "tessera/no-host-text",
    ]);
  });

  it("fails on a hook called conditionally (ENG-04)", async () => {
    const code = `import { useState } from "react";
export function App({ open }: { open: boolean }) {
  if (open) {
    const [count] = useState(0);
    return count;
  }
  return null;
}
`;
    expect(await rulesBroken(code)).toContain("react-hooks/rules-of-hooks");
  });

  it("fails on code the React Compiler can't keep correct: state set during render (A15)", async () => {
    const code = `import { useState } from "react";
export function App() {
  const [count, setCount] = useState(0);
  setCount(count + 1);
  return count;
}
`;
    expect(await rulesBroken(code)).toContain("react-hooks/set-state-in-render");
  });
});
