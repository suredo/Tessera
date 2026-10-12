// Lint rules for the TypeScript packages (ENG-04). Formatting is Prettier's job, not ESLint's.
import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  // The OKF check stays plain, dependency-free JavaScript until it moves to this tooling (#13).
  {
    ignores: ["**/node_modules/", "scripts/okf-check*.mjs", "test-output/", "coverage/"],
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
  // Plain JavaScript (configs and the Node scripts) gets Node's globals and no type-aware rules.
  {
    files: ["**/*.js", "**/*.mjs"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
);
