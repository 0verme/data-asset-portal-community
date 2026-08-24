import js from "@eslint/js";
import globals from "globals";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";

const sourceFiles = ["src/**/*.{js,jsx}"];
const nodeFiles = ["scripts/**/*.{js,mjs}", "src/**/*.test.js"];
const lintFiles = [...sourceFiles, ...nodeFiles];

export default [
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "packages/**",
      "coverage/**",
      "**/*.generated.*",
    ],
  },
  {
    ...js.configs.recommended,
    files: lintFiles,
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
    },
  },
  {
    ...react.configs.flat.recommended,
    files: sourceFiles,
    languageOptions: {
      ...react.configs.flat.recommended.languageOptions,
      ecmaVersion: "latest",
      sourceType: "module",
      globals: globals.browser,
    },
    settings: {
      react: {
        version: "detect",
      },
    },
    rules: {
      ...react.configs.flat.recommended.rules,
      // React 18 uses the automatic JSX runtime supplied by Vite.
      "react/jsx-uses-react": "off",
      "react/react-in-jsx-scope": "off",
      // This project does not use runtime PropTypes; type migration is out of scope.
      "react/prop-types": "off",
    },
  },
  {
    // Keep the React 18 baseline to Rules of Hooks and dependency checking;
    // React Compiler rules belong to a later architecture/migration task.
    ...reactHooks.configs["flat/recommended"][0],
    files: sourceFiles,
  },
  {
    files: nodeFiles,
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
  {
    files: sourceFiles,
    rules: {
      "no-unused-vars": [
        "error",
        {
          args: "after-used",
          argsIgnorePattern: "^_",
          caughtErrors: "none",
          varsIgnorePattern: "^_",
        },
      ],
    },
  },
];
