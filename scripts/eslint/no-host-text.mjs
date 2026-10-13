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
    // Whether an expression can render words written here: a string, or one reached through a
    // condition, a fallback, a concatenation or a list. Function calls are not entered, so
    // t("key") passes.
    const isText = (node) => {
      if (!node) return false;
      switch (node.type) {
        case "Literal":
          return typeof node.value === "string" && hasWords(node.value);
        case "TemplateLiteral":
          return (
            node.quasis.some((q) => hasWords(q.value.cooked ?? "")) || node.expressions.some(isText)
          );
        case "ConditionalExpression":
          return isText(node.consequent) || isText(node.alternate);
        case "LogicalExpression":
          return isText(node.right) || (node.operator !== "&&" && isText(node.left));
        case "BinaryExpression":
          return node.operator === "+" && (isText(node.left) || isText(node.right));
        case "ArrayExpression":
          return node.elements.some(isText);
        case "SequenceExpression":
          return isText(node.expressions.at(-1));
        case "TSAsExpression":
        case "TSSatisfiesExpression":
        case "TSNonNullExpression":
          return isText(node.expression);
        default:
          return false;
      }
    };
    // `value` is the caption people read on a submit, button or reset input.
    const isCaptionValue = (attribute) => {
      const opening = attribute.parent;
      if (opening.name.type !== "JSXIdentifier" || opening.name.name !== "input") return false;
      const type = opening.attributes.find(
        (a) =>
          a.type === "JSXAttribute" && a.name.type === "JSXIdentifier" && a.name.name === "type",
      );
      const typeValue = type?.value?.type === "Literal" ? type.value.value : undefined;
      return ["submit", "button", "reset"].includes(typeValue);
    };
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
        const holdsText = TEXT_ATTRIBUTES.has(name) || (name === "value" && isCaptionValue(node));
        if (!holdsText || !node.value) return;
        const value =
          node.value.type === "JSXExpressionContainer" ? node.value.expression : node.value;
        if (isText(value)) context.report({ node, messageId: "hostText" });
      },
    };
  },
};
