import { useId, useState, type ReactNode } from "react";
import { t } from "./i18n/translate.ts";

// Importing a workspace or saved tool from a file (APP-06, DATA-05): the person picks a .tessera
// file, and the app says what came in, or why nothing did.

/** `icon`, shown before the label where the row has one, such as on the first-run screen. */
export function ImportFile({
  onImport,
  icon,
}: {
  onImport: (file: File) => Promise<void>;
  icon?: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  // One per place it shows: the drawer and the first-run screen can both be in the page.
  const id = useId();
  return (
    // A row like the drawer's others: the label is what shows; the file field stays for the
    // keyboard and screen readers, out of sight.
    <div className="import-file">
      <label htmlFor={id}>
        {icon}
        {t("archive.importLabel")}
      </label>
      <input
        className="visually-hidden"
        id={id}
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
