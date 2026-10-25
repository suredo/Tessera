import { useId, useState } from "react";
import { t } from "./i18n/translate.ts";
import type { MessageKey } from "./i18n/en.ts";

// A name to give something, asked for in place: a labelled field with Save and Cancel. Renaming a
// workspace or a saved tool, saving to my tools and saving as a new tool all ask this way.

type Props = {
  /** The field's label, already translated. */
  label: string;
  initial: string;
  /** The submit button's text; Save by default. */
  confirm?: MessageKey;
  onSubmit: (name: string) => Promise<void>;
  onCancel: () => void;
};

export function NameForm({
  label,
  initial,
  confirm = "library.confirm",
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
      <input
        id={id}
        value={name}
        onChange={(event) => setName(event.target.value)}
        maxLength={200}
        required
        autoFocus
      />
      <button type="submit">{t(confirm)}</button>
      <button type="button" onClick={onCancel}>
        {t("library.cancel")}
      </button>
    </form>
  );
}
