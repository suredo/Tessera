import { useState } from "react";
import { t } from "./i18n/translate.ts";

// Importing a workspace or saved tool from a file (APP-06, DATA-05): the person picks a .tessera
// file, and the app says what came in, or why nothing did.

export function ImportFile({ onImport }: { onImport: (file: File) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="import-file">
      <label htmlFor="import-file">{t("archive.importLabel")}</label>
      <input
        id="import-file"
        type="file"
        accept=".tessera"
        disabled={busy}
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Cleared, so picking the same file again imports it again.
          event.target.value = "";
          if (!file) return;
          setBusy(true);
          void onImport(file).finally(() => setBusy(false));
        }}
      />
    </div>
  );
}
