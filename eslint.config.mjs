import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import eslintReact from "@eslint-react/eslint-plugin";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  {
    ignores: ["extension/", "node_modules/"],
  },
  {
    // Extension source: React pages, background worker, and the scripts
    // injected into web pages.
    files: ["source/**/*.{ts,tsx,js}"],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      eslintReact.configs["recommended-typescript"],
    ],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.webextensions,
      },
    },
    rules: {
      // The codebase types most React state and message payloads as `any`.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],

      // Pre-existing violations, downgraded to warnings until the code is cleaned up.
      "@eslint-react/no-create-ref": "warn",
      "no-useless-assignment": "warn",
      "no-var": "warn",
      "prefer-const": "warn",
    },
  },
  {
    // CommonJS modules shared with Node (bundled by webpack, and loaded by node:test).
    files: ["source/dingocoin.js", "source/accounts.js", "source/electrum.js", "source/provider.js"],
    languageOptions: {
      sourceType: "commonjs",
      globals: globals.node,
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      // `const crypto = require("crypto")` intentionally shadows the Web Crypto global.
      "no-redeclare": ["error", { builtinGlobals: false }],
    },
  },
  {
    files: ["webpack.config.js", "polyfills/**/*.js", "test/**/*.js"],
    extends: [js.configs.recommended],
    languageOptions: {
      sourceType: "commonjs",
      globals: globals.node,
    },
  },
);
