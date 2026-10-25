import { UI_TOKENS } from "@tessera/runtime/policy";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { t } from "./i18n/translate.ts";

import "./app.css";

// Starts the host app in the page served by Vite (index.html).
document.title = t("app.title");
// The UI standard's tokens, from the one definition the tools' stylesheets use (VER-06, P3).
for (const [name, value] of Object.entries(UI_TOKENS)) {
  document.documentElement.style.setProperty(`--ui-${name}`, value);
}
const root = document.getElementById("root");
if (!root) throw new Error("index.html has no #root element.");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
