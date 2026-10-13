import babel from "@rolldown/plugin-babel";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The host app: React 19 with the React Compiler (A15), which runs as a Babel preset.
export default defineConfig({
  plugins: [react(), babel({ presets: [reactCompilerPreset()] })],
});
