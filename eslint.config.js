// Lint rules for the TypeScript packages (ENG-04). Formatting is Prettier's job, not ESLint's.
import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";
import noHostText from "./scripts/eslint/no-host-text.mjs";

export default defineConfig(
  {
    ignores: ["**/node_modules/", "**/dist/", "test-output/", "coverage/"],
  },
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ["*.config.ts"] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  // React components: the hooks rules and the React Compiler's rules (A15), and no host text
  // written in a component (UX-05).
  {
    files: ["packages/web/**/*.tsx"],
    extends: [reactHooks.configs.flat["recommended-latest"]],
    plugins: { tessera: { rules: { "no-host-text": noHostText } } },
    rules: { "tessera/no-host-text": "error" },
  },
  // Plain JavaScript (configs and the Node scripts) gets Node's globals and no type-aware rules.
  {
    files: ["**/*.js", "**/*.mjs"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
);
