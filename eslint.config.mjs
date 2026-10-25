import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Tooling rather than the app: design-sync's workspace and output, and
    // Rust's build folder.
    ".design-sync/**",
    ".ds-sync/**",
    "ds-bundle/**",
    "types/**",
    "src-tauri/target/**",
  ]),
]);

export default eslintConfig;
