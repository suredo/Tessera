import { en, type MessageKey } from "./en.ts";

// The translation layer (UX-05): components ask for host text by key and never hold it themselves.

export type Messages = Partial<Record<MessageKey, string>>;
export type Params = Record<string, string | number>;
export type Translate = (key: MessageKey, params?: Params) => string;
/** Told about each key a language lacks, so a gap is noticed instead of silently showing English. */
export type MissingHandler = (key: string, locale: string) => void;

const warnMissing: MissingHandler = (key, locale) => {
  console.warn(`Host text "${key}" is missing in ${locale}.`);
};

/**
 * Looks a key up in the language's messages, then in English. A key missing from both shows as
 * the key itself, so the gap is visible on screen. `{name}` placeholders take values from params.
 */
export function createTranslator(
  locale: string,
  messages: Messages,
  onMissing: MissingHandler = warnMissing,
): Translate {
  return (key, params = {}) => {
    let text: string | undefined = messages[key];
    if (text === undefined && locale !== "en") {
      onMissing(key, locale);
      text = (en as Messages)[key];
    }
    if (text === undefined) {
      onMissing(key, "en");
      return key;
    }
    return text.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
      name in params ? String(params[name]) : placeholder,
    );
  };
}

/** The host's translator. Only English ships at first (A10). */
export const t = createTranslator("en", en);
