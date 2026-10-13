// ESLint rule: host text never sits in a component; it comes from the translation layer (UX-05).
// Reports words written as JSX text, string children, and text attributes such as aria-label.

const TEXT_ATTRIBUTES = new Set([
  "alt",
  "title",
  "placeholder",
  "label",
  "aria-label",
  "aria-description",
]);
const hasWords = (text) => /\p{L}/u.test(text);
const MESSAGE = 'Host text must come from the translation layer: use t("key") (UX-05).';

/** @type {import("eslint").Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: { description: "Disallow host text written directly in components (UX-05)" },
    schema: [],
    messages: { hostText: MESSAGE },
  },
  create(context) {
    const isText = (node) =>
      (node.type === "Literal" && typeof node.value === "string" && hasWords(node.value)) ||
      (node.type === "TemplateLiteral" && node.quasis.some((q) => hasWords(q.value.cooked ?? "")));
    return {
      JSXText(node) {
        if (hasWords(node.value)) context.report({ node, messageId: "hostText" });
      },
      JSXExpressionContainer(node) {
        if (node.parent.type !== "JSXAttribute" && isText(node.expression)) {
          context.report({ node, messageId: "hostText" });
        }
      },
      JSXAttribute(node) {
        const name = node.name.type === "JSXIdentifier" ? node.name.name : "";
        if (!TEXT_ATTRIBUTES.has(name) || !node.value) return;
        const value =
          node.value.type === "JSXExpressionContainer" ? node.value.expression : node.value;
        if (isText(value)) context.report({ node, messageId: "hostText" });
      },
    };
  },
};
