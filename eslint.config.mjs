import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig([
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "**/coverage/**",
      "contracts/cache/**",
      "contracts/out/**",
      "contracts/broadcast/**",
    ],
  },

  {
    files: ["**/*.{js,mjs,cjs,ts,mts,cts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended, prettier],
  },
]);
