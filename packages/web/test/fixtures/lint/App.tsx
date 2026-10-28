// A real file lets ESLint's project service locate this fixture's small typed project.
// lint.test.ts supplies each component through lintText; the production rules still apply.
import { t } from "../../../src/i18n/translate.ts";

export function App() {
  return <h1>{t("app.title")}</h1>;
}
