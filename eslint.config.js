// @ts-check

import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    // AssemblyScript sources use syntax stock typescript-eslint can't parse
    // (decorators on const/function declarations, `<T>` value casts). They are
    // type-checked by `asc` instead.
    ignores: ["assembly/**", "build/**", ".as-test/**", "**/*.tmp.ts"],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{js,mjs,cjs,ts}"],
    languageOptions: {
      globals: {
        Buffer: "readonly",
        WebAssembly: "readonly",
        console: "readonly",
        process: "readonly",
      },
    },
  },
  {
    files: ["assembly/**/*.ts"],
    rules: {
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/triple-slash-reference": "off",
      "no-constant-condition": "off",
      "no-empty": "off",
      "no-loss-of-precision": "off",
      "prefer-const": "off",
    },
  },
);
