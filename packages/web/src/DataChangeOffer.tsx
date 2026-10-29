import type { GenerateReply, JsonValue } from "@tessera/contracts";
import { t } from "./i18n/translate.ts";

/** The host's complete before/after facts, not a model-written explanation of its targets. */
function Value({ value }: { value: JsonValue }) {
  if (value === null) return <span>{t("request.reviewNone")}</span>;
  if (typeof value === "boolean")
    return <span>{t(value ? "request.reviewYes" : "request.reviewNo")}</span>;
  if (typeof value !== "object")
    return <span>{value === "" ? t("request.reviewEmptyText") : String(value)}</span>;
  if (Array.isArray(value))
    return value.length === 0 ? (
      <span>{t("request.reviewEmptyList")}</span>
    ) : (
      <ul>
        {value.map((item, index) => (
          <li key={index}>
            <Value value={item} />
          </li>
        ))}
      </ul>
    );
  if (Object.keys(value).length === 0) return <span>{t("request.reviewEmptyObject")}</span>;
  return (
    <dl>
      {Object.entries(value).map(([key, item]) => (
        <div key={key}>
          <dt>{key}</dt>
          <dd>
            <Value value={item} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function DataChangeOffer({
  offer,
  working,
  onChoose,
}: {
  offer: Extract<GenerateReply, { kind: "data_confirmation" }>;
  working: boolean;
  onChoose: (approve: boolean) => Promise<void>;
}) {
  return (
    <section aria-label={t("request.dataReview")} className="data-review">
      <h2>
        {t(offer.changes.length === 1 ? "request.reviewHeadingOne" : "request.reviewHeading", {
          count: offer.changes.length,
          name: offer.name,
        })}
      </h2>
      <p>{offer.summary}</p>
      {offer.changes.map((change, index) => (
        <section key={`${change.collection}:${change.id}`}>
          <h3>{t("request.reviewItem", { index: index + 1, collection: change.collection })}</h3>
          <h4>{t("request.reviewBefore")}</h4>
          {change.before === null ? (
            <p>{t("request.reviewEmpty")}</p>
          ) : (
            <Value
              value={Object.fromEntries(
                Object.entries(change.before).filter(([key]) => key !== "id"),
              )}
            />
          )}
          <h4>{t("request.reviewAfter")}</h4>
          {change.after === null ? (
            <p>{t("request.reviewEmpty")}</p>
          ) : (
            <Value
              value={Object.fromEntries(
                Object.entries(change.after).filter(([key]) => key !== "id"),
              )}
            />
          )}
        </section>
      ))}
      <button type="button" disabled={working} onClick={() => void onChoose(true)}>
        {t("request.reviewApply")}
      </button>
      <button type="button" disabled={working} onClick={() => void onChoose(false)}>
        {t("request.reviewCancel")}
      </button>
    </section>
  );
}
