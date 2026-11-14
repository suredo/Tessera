import {
  CONNECTION_KEY_LIMIT,
  CONNECTION_ORIGINS_LIMIT,
  connectionNameSchema,
  connectionOriginSchema,
  type Connection,
  type ConnectionInput,
} from "@tessera/contracts";
import { useId, useState } from "react";
import { t } from "./i18n/translate.ts";

// The connections the person adds (CAP-02, ADR 0015 point 1, A71): a section of its own, listing
// each connection with its addresses and whether a key is kept, never the key; adding one names
// it, its addresses and how its key is sent, in three plain choices with a header first; removing
// one is confirmed, since its key goes with it. The form checks what it can in plain words before
// asking the host, which checks it all again (CON-01).

const day = new Intl.DateTimeFormat("en", { dateStyle: "medium" });

type KeyWay = "none" | "header" | "query";

/** What the add form holds, as typed. */
export type ConnectionFields = {
  name: string;
  addresses: string[];
  keyWay: KeyWay;
  headerName: string;
  headerPrefix: string;
  queryName: string;
  key: string;
};

export const emptyFields = (): ConnectionFields => ({
  name: "",
  addresses: [""],
  keyWay: "header",
  headerName: "Authorization",
  headerPrefix: "Bearer ",
  queryName: "api_key",
  key: "",
});

const FIELD_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,100}$/;

/**
 * An address as the host keeps it: its origin, with a lone trailing slash allowed; else null. A
 * name and password in it are refused, not dropped: a key belongs in the key field.
 */
function origin(typed: string): string | null {
  const value = typed.trim();
  try {
    const url = new URL(value);
    if (url.username || url.password) return null;
    if (url.pathname !== "/" || url.search || url.hash) return null;
    return connectionOriginSchema.safeParse(url.origin).success ? url.origin : null;
  } catch {
    return null;
  }
}

/** The form's fields as a connection to add, or the first problem, in plain words. */
export function readFields(
  fields: ConnectionFields,
): { ok: true; input: ConnectionInput } | { ok: false; problem: string } {
  const name = fields.name.trim();
  if (!connectionNameSchema.safeParse(name).success) {
    return { ok: false, problem: t("connections.badName") };
  }
  const typed = fields.addresses.map((each) => each.trim()).filter((each) => each !== "");
  if (typed.length === 0) return { ok: false, problem: t("connections.noAddress") };
  const origins: string[] = [];
  for (const each of typed) {
    const found = origin(each);
    if (!found) return { ok: false, problem: t("connections.badAddress", { address: each }) };
    if (!origins.includes(found)) origins.push(found);
  }
  if (fields.keyWay === "none") {
    return { ok: true, input: { name, origins, auth: { kind: "none" }, key: null } };
  }
  const key = fields.key.trim();
  if (key === "" || key.length > CONNECTION_KEY_LIMIT || /[\r\n]/.test(key)) {
    return { ok: false, problem: t("connections.badKey") };
  }
  if (fields.keyWay === "header") {
    const headerName = fields.headerName.trim();
    if (!FIELD_NAME.test(headerName)) return { ok: false, problem: t("connections.badHeader") };
    if (fields.headerPrefix.length > 40 || /[\r\n]/.test(fields.headerPrefix)) {
      return { ok: false, problem: t("connections.badPrefix") };
    }
    return {
      ok: true,
      input: {
        name,
        origins,
        auth: { kind: "header", name: headerName, prefix: fields.headerPrefix },
        key,
      },
    };
  }
  const queryName = fields.queryName.trim();
  if (!FIELD_NAME.test(queryName)) return { ok: false, problem: t("connections.badParameter") };
  return { ok: true, input: { name, origins, auth: { kind: "query", name: queryName }, key } };
}

/** How a connection's key is sent, in plain words, never the key. */
export const keyText = (connection: Connection): string =>
  connection.auth.kind === "none"
    ? t("connections.noKey")
    : !connection.hasKey
      ? t("connections.keyMissing")
      : connection.auth.kind === "header"
        ? t("connections.keyInHeader", { header: connection.auth.name })
        : t("connections.keyInAddress", { parameter: connection.auth.name });

type FormProps = {
  onAdd: (input: ConnectionInput) => Promise<boolean>;
  onCancel: () => void;
};

function AddForm({ onAdd, onCancel }: FormProps) {
  const [fields, setFields] = useState(emptyFields);
  const [problem, setProblem] = useState("");
  const [working, setWorking] = useState(false);
  const id = useId();
  const set = (change: Partial<ConnectionFields>) => setFields((now) => ({ ...now, ...change }));
  const setAddress = (index: number, value: string) =>
    set({ addresses: fields.addresses.map((each, at) => (at === index ? value : each)) });

  return (
    <form
      className="connection-form"
      aria-labelledby={`${id}-heading`}
      // The form's own checks say what to fix in plain words, never the browser's (GEN-12).
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const read = readFields(fields);
        if (!read.ok) return setProblem(read.problem);
        setProblem("");
        setWorking(true);
        void onAdd(read.input).then((added) => {
          setWorking(false);
          if (added) onCancel();
        });
      }}
    >
      <h3 id={`${id}-heading`}>{t("connections.addHeading")}</h3>
      <label htmlFor={`${id}-name`}>{t("connections.name")}</label>
      <input
        id={`${id}-name`}
        value={fields.name}
        onChange={(event) => set({ name: event.target.value })}
        aria-describedby={`${id}-name-hint`}
        maxLength={40}
        autoComplete="off"
        spellCheck={false}
        required
        autoFocus
      />
      <p id={`${id}-name-hint`} className="detail">
        {t("connections.nameHint")}
      </p>
      <fieldset>
        <legend>{t("connections.addresses")}</legend>
        <p id={`${id}-address-hint`} className="detail">
          {t("connections.addressHint")}
        </p>
        {fields.addresses.map((address, index) => (
          <div key={index} className="connection-address">
            <input
              type="url"
              value={address}
              aria-label={t("connections.addressLabel", { number: index + 1 })}
              aria-describedby={`${id}-address-hint`}
              placeholder={t("connections.addressPlaceholder")}
              onChange={(event) => setAddress(index, event.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            {fields.addresses.length > 1 && (
              <button
                type="button"
                aria-label={t("connections.removeAddressLabel", { number: index + 1 })}
                onClick={() => set({ addresses: fields.addresses.filter((_, at) => at !== index) })}
              >
                {t("connections.removeAddress")}
              </button>
            )}
          </div>
        ))}
        {fields.addresses.length < CONNECTION_ORIGINS_LIMIT && (
          <button type="button" onClick={() => set({ addresses: [...fields.addresses, ""] })}>
            {t("connections.anotherAddress")}
          </button>
        )}
      </fieldset>
      <fieldset>
        <legend>{t("connections.keyQuestion")}</legend>
        <label className="choice">
          <input
            type="radio"
            name={`${id}-key-way`}
            checked={fields.keyWay === "none"}
            onChange={() => set({ keyWay: "none" })}
          />{" "}
          {t("connections.wayNone")}
        </label>
        <label className="choice">
          <input
            type="radio"
            name={`${id}-key-way`}
            checked={fields.keyWay === "header"}
            onChange={() => set({ keyWay: "header" })}
          />{" "}
          {t("connections.wayHeader")}
        </label>
        {fields.keyWay === "header" && (
          <div className="connection-way">
            <label htmlFor={`${id}-header`}>{t("connections.headerName")}</label>
            <input
              id={`${id}-header`}
              value={fields.headerName}
              onChange={(event) => set({ headerName: event.target.value })}
              maxLength={100}
              autoComplete="off"
              spellCheck={false}
            />
            <label htmlFor={`${id}-prefix`}>{t("connections.headerPrefix")}</label>
            <input
              id={`${id}-prefix`}
              value={fields.headerPrefix}
              onChange={(event) => set({ headerPrefix: event.target.value })}
              maxLength={40}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        )}
        <label className="choice">
          <input
            type="radio"
            name={`${id}-key-way`}
            checked={fields.keyWay === "query"}
            onChange={() => set({ keyWay: "query" })}
          />{" "}
          {t("connections.wayQuery")}
        </label>
        {fields.keyWay === "query" && (
          <div className="connection-way">
            <label htmlFor={`${id}-parameter`}>{t("connections.queryName")}</label>
            <input
              id={`${id}-parameter`}
              value={fields.queryName}
              onChange={(event) => set({ queryName: event.target.value })}
              maxLength={100}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        )}
      </fieldset>
      {fields.keyWay !== "none" && (
        <>
          <label htmlFor={`${id}-key`}>{t("connections.key")}</label>
          <input
            id={`${id}-key`}
            type="password"
            value={fields.key}
            onChange={(event) => set({ key: event.target.value })}
            aria-describedby={`${id}-key-hint`}
            maxLength={CONNECTION_KEY_LIMIT}
            autoComplete="off"
            spellCheck={false}
          />
          <p id={`${id}-key-hint`} className="detail">
            {t("connections.keyHint")}
          </p>
        </>
      )}
      <p role="alert" className="problem">
        {problem}
      </p>
      <button type="submit" className="primary" disabled={working}>
        {t("connections.add")}
      </button>{" "}
      <button type="button" onClick={onCancel}>
        {t("connections.cancel")}
      </button>
    </form>
  );
}

type Props = {
  /** Every connection, or null while they load. */
  connections: readonly Connection[] | null;
  /** Adds one; resolves true once it is kept, false when the host refused it. */
  onAdd: (input: ConnectionInput) => Promise<boolean>;
  onRemove: (name: string) => Promise<void>;
  /** Starts with the add form open, as for a test. */
  adding?: boolean;
};

export function Connections({ connections, onAdd, onRemove, adding = false }: Props) {
  const [formOpen, setFormOpen] = useState(adding);
  const [removing, setRemoving] = useState<string | null>(null);

  return (
    <section aria-labelledby="connections-heading" className="connections">
      <h2 id="connections-heading">{t("connections.heading")}</h2>
      <p>{t("connections.intro")}</p>
      {connections?.length === 0 && <p>{t("connections.none")}</p>}
      <ul>
        {(connections ?? []).map((connection) => (
          <li key={connection.name} className="connection">
            <h3>{connection.name}</h3>
            <ul
              className="detail"
              aria-label={t("connections.addressesOf", { name: connection.name })}
            >
              {connection.origins.map((each) => (
                <li key={each}>{each}</li>
              ))}
            </ul>
            <p className="detail">{keyText(connection)}</p>
            <p className="detail">
              {t("connections.added", { date: day.format(new Date(connection.addedAt)) })}
            </p>
            {removing === connection.name ? (
              <div role="group" aria-labelledby={`remove-${connection.name}`} className="confirm">
                <p id={`remove-${connection.name}`}>
                  {t("connections.confirmRemove", { name: connection.name })}
                </p>
                <button
                  type="button"
                  className="primary"
                  onClick={() => void onRemove(connection.name).then(() => setRemoving(null))}
                >
                  {t("connections.remove")}
                </button>{" "}
                <button type="button" onClick={() => setRemoving(null)}>
                  {t("connections.cancel")}
                </button>
              </div>
            ) : (
              <button
                type="button"
                aria-label={t("connections.removeLabel", { name: connection.name })}
                onClick={() => setRemoving(connection.name)}
              >
                {t("connections.remove")}
              </button>
            )}
          </li>
        ))}
      </ul>
      {formOpen ? (
        <AddForm onAdd={onAdd} onCancel={() => setFormOpen(false)} />
      ) : (
        <button type="button" onClick={() => setFormOpen(true)}>
          {t("connections.addOne")}
        </button>
      )}
    </section>
  );
}
