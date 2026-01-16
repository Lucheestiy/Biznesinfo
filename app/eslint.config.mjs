import globals from "globals";
import tsParser from "@typescript-eslint/parser";

const baseFiles = ["**/*.{js,jsx,mjs,ts,tsx,mts,cts}"];
const baseIgnores = ["node_modules/**", ".next/**", "dist/**"];

const commonRules = {
  "no-console": "warn",
  "no-duplicate-imports": "error",
  "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
};

export default [
  {
    ignores: baseIgnores,
  },
  {
    files: baseFiles,
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: commonRules,
  },
];
