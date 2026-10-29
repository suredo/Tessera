import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { GenerateReply, JsonValue } from "@tessera/contracts";
import { DataChangeOffer } from "../src/DataChangeOffer.tsx";
import { dataOutcome } from "../src/generate.ts";

const offer: Extract<GenerateReply, { kind: "data_confirmation" }> = {
  kind: "data_confirmation",
  workspaceId: "00000000-0000-4000-8000-000000000001",
  name: "Shopping list",
  token: "00000000-0000-4000-8000-000000000002",
  summary: "Rename the item.",
  changes: [
    {
      collection: "items",
      id: "hidden-stable-id",
      before: { id: "hidden-stable-id", title: "Milk", details: { id: "old detail" }, empty: [] },
      after: {
        id: "hidden-stable-id",
        title: "Oat milk",
        details: { id: "new detail" },
        empty: {},
      },
    },
  ],
};
it("GEN-01 GEN-08: confirmation displays complete target facts, never claims a proposed patch was applied", () => {
  const html = renderToStaticMarkup(
    <DataChangeOffer offer={offer} working onChoose={() => Promise.resolve()} />,
  );
  expect(html).toContain("Milk");
  expect(html).toContain("Oat milk");
  expect(html).toContain("old detail");
  expect(html).toContain("new detail");
  expect(html).toContain("Empty list");
  expect(html).toContain("No fields");
  expect(html).not.toContain("hidden-stable-id");
  expect(html.match(/disabled=""/g)).toHaveLength(2);
  expect(dataOutcome(offer)).toEqual({
    message: "Review the proposed entry changes before applying them.",
    dataOffer: offer,
  });
  expect(
    dataOutcome({
      kind: "data_changed",
      workspaceId: offer.workspaceId,
      name: "Shopping list",
      count: 1,
      summary: "Renamed Milk.",
    }),
  ).toEqual({
    message: "Changed one entry in Shopping list. Renamed Milk.",
    openWorkspaceId: offer.workspaceId,
    dataChanged: true,
  });
  expect(dataOutcome({ kind: "answer", answer: "data_cancelled" }).message).toContain("cancelled");
});

it("GEN-01 DATA-02: review values distinguish types, sentinel text and whitespace", () => {
  const pairs: [JsonValue, JsonValue][] = [
    [1, "1"],
    [null, "None"],
    [true, "Yes"],
    [false, "No"],
    ["", "Empty text"],
    [[], "Empty list"],
    [{}, "No fields"],
    ["a\nb", "a b"],
  ];
  for (const [before, after] of pairs) {
    const html = renderToStaticMarkup(
      <DataChangeOffer
        offer={{
          ...offer,
          changes: [
            {
              collection: "items",
              id: "target",
              before: { id: "target", value: before },
              after: { id: "target", value: after },
            },
          ],
        }}
        working={false}
        onChoose={() => Promise.resolve()}
      />,
    );
    const sections = /<h4>Before<\/h4>([\s\S]*?)<h4>After<\/h4>([\s\S]*?)<\/section>/.exec(html);
    expect(sections).not.toBeNull();
    expect(sections![1]).not.toBe(sections![2]);
  }
});
