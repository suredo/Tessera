import { t } from "./i18n/translate.ts";

// The host's first screen. A placeholder until M1 brings the chat and the tool panel (APP-01).
export function App() {
  return (
    <main>
      <h1>{t("home.heading")}</h1>
      <p>{t("home.intro")}</p>
      <p role="status">{t("home.status")}</p>
    </main>
  );
}
