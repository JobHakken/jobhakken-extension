import js from '@eslint/js';
import security from 'eslint-plugin-security';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

// Flat config. Uses typescript-eslint v8 (eslint-9 native) rather than the monorepo's
// @typescript-eslint v7 — v7's peer range excludes eslint 9, so the monorepo combo is
// peer-invalid (pnpm tolerates it, npm won't). Same rule spirit, current tooling.
export default tseslint.config(
  {
    ignores: [
      'dist/',
      'node_modules/',
      'e2e/fixtures/',
      // Playwright dev harnesses: they embed browser code inside page.evaluate() callbacks (document,
      // window, …) that ESLint's Node parse can't reason about. Not shipped code — exclude from lint.
      'e2e/tools/',
      'full_website/',
      'playwright-report/',
      'test-results/',
      'src/data/**',
      '**/*.zip',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  security.configs.recommended,
  {
    // Extension source: browser + service-worker + web-extension globals.
    files: ['src/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.serviceworker, ...globals.webextensions, chrome: 'readonly' },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Page DOM is untrusted; we index into records deliberately. The dynamic-object rule is
      // too noisy for this codebase — rely on explicit validation + review instead.
      'security/detect-object-injection': 'off',
    },
  },
  {
    // Tests (jest + jsdom) and Playwright e2e run under Node.
    files: ['**/*.test.ts', 'e2e/**/*.ts'],
    languageOptions: { globals: { ...globals.jest, ...globals.node } },
    // Playwright fixtures use an empty destructuring pattern: async ({}, testInfo) => …
    rules: { 'no-empty-pattern': 'off' },
  },
  {
    // Build, scripts, mocks, and config files are Node (ESM .mjs + CommonJS .cjs).
    files: ['**/*.mjs', '**/*.cjs'],
    languageOptions: { globals: globals.node },
  },
  prettier, // must stay last: disables formatting rules that would fight Prettier
);
