import path from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

// Lints small components with the repository's own ESLint config, as if they were web code.
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const eslint = new ESLint({ cwd: repo });
const rulesBroken = async (code: string): Promise<(string | null)[]> => {
  const [result] = await eslint.lintText(code, {
    filePath: path.join(repo, "packages/web/src/App.tsx"),
  });
  return (result?.messages ?? []).map((m) => m.ruleId);
};

describe("web lint rules", { timeout: 60_000 }, () => {
  it("passes a component whose text comes from the translation layer (UX-05)", async () => {
    const code = `import { t } from "./i18n/translate.ts";
export function App() {
  return <h1 title={t("app.title")}>{t("home.heading")}</h1>;
}
`;
    expect(await rulesBroken(code)).toEqual([]);
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
