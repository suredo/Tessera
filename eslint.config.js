// Lint rules for the TypeScript packages (ENG-04). Formatting is Prettier's job, not ESLint's.
import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
  // The OKF check stays plain, dependency-free JavaScript until it moves to this tooling (#13).
  { ignores: ["**/node_modules/", "scripts/", "test-output/", "coverage/"] },
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
  { files: ["**/*.js"], extends: [tseslint.configs.disableTypeChecked] },
);
