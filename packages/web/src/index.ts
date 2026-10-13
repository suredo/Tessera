// Docs: docs/code/web/package.md
// @tessera/web: the host app in the browser, built with Vite and React 19 (A15).
export { App } from "./App.tsx";
export { en, type MessageKey } from "./i18n/en.ts";
export {
  createTranslator,
  t,
  type Messages,
  type MissingHandler,
  type Params,
  type Translate,
} from "./i18n/translate.ts";
