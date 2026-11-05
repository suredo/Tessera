import { useId, useState } from "react";
import { t } from "./i18n/translate.ts";
import type { MessageKey } from "./i18n/en.ts";

// A name to give something, asked for in place: a labelled field with Save and Cancel. Renaming a
// workspace or a saved tool, saving to my tools and saving as a new tool all ask this way. A saved
// tool's description is asked the same way, in a larger field that may be left empty (APP-04).

type Props = {
  /** The field's label, already translated. */
  label: string;
  initial: string;
  /** The submit button's text; Save by default. */
  confirm?: MessageKey;
  /** A description: a few lines, up to 400 characters, and empty allowed. */
  description?: boolean;
  onSubmit: (name: string) => Promise<void>;
  onCancel: () => void;
};

export function NameForm({
  label,
  initial,
  confirm = "library.confirm",
  description = false,
  onSubmit,
  onCancel,
}: Props) {
  const [name, setName] = useState(initial);
  const id = useId();
  return (
    <form
      className="name-form"
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit(name.trim());
      }}
    >
      <label htmlFor={id}>{label}</label>
      {description ? (
        <textarea
          id={id}
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={400}
          rows={3}
          autoFocus
        />
      ) : (
        <input
          id={id}
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={200}
          required
          autoFocus
        />
      )}
      <button type="submit">{t(confirm)}</button>
      <button type="button" onClick={onCancel}>
        {t("library.cancel")}
      </button>
    </form>
  );
}
