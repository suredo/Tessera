import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { t } from "./i18n/translate.ts";

// Starts the host app in the page served by Vite (index.html).
document.title = t("app.title");
const root = document.getElementById("root");
if (!root) throw new Error("index.html has no #root element.");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
