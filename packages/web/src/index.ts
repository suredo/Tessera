// Docs: docs/code/web/package.md
// @tessera/web: the host app in the browser, built with Vite and React 19 (A15).
export { App, EmptyState } from "./App.tsx";
export { checkSetup, formatBytes, runProbe } from "./setup.ts";
export { SetupNotice, Status } from "./Status.tsx";
export { ask, HostError, type Send } from "./host-api.ts";
export { en, type MessageKey } from "./i18n/en.ts";
export {
  createTranslator,
  t,
  type Messages,
  type MissingHandler,
  type Params,
  type Translate,
} from "./i18n/translate.ts";
