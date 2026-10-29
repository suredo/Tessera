import type { Creation, Edit } from "@tessera/contracts";

const schema = {
  type: "object",
  required: ["items"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "title"],
        properties: { id: { type: "string" }, title: { type: "string" } },
        additionalProperties: false,
      },
    },
  },
  additionalProperties: false,
};
export const editFixture: Extract<Creation, { outcome: "tool" }> = {
  outcome: "tool",
  name: "Shopping list",
  summary: "A list of what to buy.",
  code: {
    html: '<h1>Shopping list</h1><ul id="items"></ul>',
    css: "body{background:#fff;color:#111}",
    js: `tessera.call("data.read").then(({ data }) => {
  for (const item of data.items) {
    const row = document.createElement("li");
    row.textContent = item.title;
    document.getElementById("items").append(row);
  }
});`,
  },
  data: {
    schema,
    reusableDefaults: { items: [] },
    initialState: {
      items: [
        { id: "i-1", title: "Milk" },
        { id: "i-2", title: "Eggs" },
      ],
    },
  },
  capabilities: [],
  uiMode: "standard",
};
export const noEdit: Extract<Edit, { outcome: "edit" }> = {
  outcome: "edit",
  summary: "Kept the tool as it is.",
  files: { mode: "unchanged" },
  data: { mode: "unchanged" },
};
const darkCode = { ...editFixture.code, css: "body{background:#111;color:#eee}" };
export const styleEdit: Extract<Edit, { outcome: "edit" }> = {
  ...noEdit,
  summary: "Made it darker.",
  files: { mode: "replace", code: darkCode },
};
export const quantityEdit: Extract<Edit, { outcome: "edit" }> = {
  ...noEdit,
  summary: "Added quantities.",
  files: {
    mode: "replace",
    code: {
      ...darkCode,
      js: `tessera.call("data.read").then(({ data }) => {
  for (const item of data.items) {
    const row = document.createElement("li");
    row.textContent = item.title + ": " + item.quantity;
    document.getElementById("items").append(row);
  }
});`,
    },
  },
  data: {
    mode: "migrate",
    schema: {
      ...schema,
      properties: {
        items: {
          ...schema.properties.items,
          items: {
            ...schema.properties.items.items,
            required: ["id", "title", "quantity"],
            properties: {
              ...schema.properties.items.items.properties,
              quantity: { type: "number" },
            },
          },
        },
      },
    },
    defaults: { items: [] },
    migration: {
      fromVersion: 1,
      toVersion: 2,
      operations: [{ op: "addField", collection: "items", fields: { quantity: 1 } }],
    },
  },
};
