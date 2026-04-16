import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import typescript from 'typescript-eslint';

const browserGlobals = {
  ...globals.browser,
  ...globals.es2021,
};

const nodeGlobals = {
  ...globals.node,
  ...globals.es2021,
};

const testGlobals = {
  ...nodeGlobals,
  ...globals.jest,
};

const serviceWorkerGlobals = {
  ...browserGlobals,
  caches: 'readonly',
  clients: 'readonly',
  fetch: 'readonly',
  self: 'readonly',
  Response: 'readonly',
  URL: 'readonly',
};

const edgeFunctionGlobals = {
  ...browserGlobals,
  ...nodeGlobals,
  AbortController: 'readonly',
  AbortSignal: 'readonly',
  Blob: 'readonly',
  Body: 'readonly',
  btoa: 'readonly',
  atob: 'readonly',
  crypto: 'readonly',
  Deno: 'readonly',
  File: 'readonly',
  FormData: 'readonly',
  Headers: 'readonly',
  ReadableStream: 'readonly',
  Request: 'readonly',
  Response: 'readonly',
  URL: 'readonly',
  URLPattern: 'readonly',
  URLSearchParams: 'readonly',
};

const sharedRules = {
  '@typescript-eslint/no-explicit-any': 'warn',
  '@typescript-eslint/no-unused-vars': [
    'warn',
    {
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_',
      caughtErrorsIgnorePattern: '^_',
    },
  ],
  'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
  'no-debugger': 'error',
  'no-var': 'error',
  'prefer-const': 'warn',
  eqeqeq: ['warn', 'always'],
  curly: 'warn',
  'no-prototype-builtins': 'warn',
  'no-empty': ['warn', { allowEmptyCatch: true }],
  'no-useless-escape': 'warn',
};

export default [
  {
    ignores: [
      'dist',
      'coverage',
      'node_modules',
      '.git',
      '.pnpm-store',
      'public/locales/*.json',
      'public/version.json',
    ],
  },
  js.configs.recommended,
  ...typescript.configs.recommended,
  {
    files: ['src/**/*.{js,jsx,ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: browserGlobals,
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    plugins: {
      react,
      'react-hooks': reactHooks,
    },
    rules: {
      ...sharedRules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    files: [
      '**/*.{config,setup}.{js,mjs,cjs,ts}',
      '*.config.{js,mjs,cjs,ts}',
      'vite-plugin-*.js',
      'scripts/**/*.{js,mjs,cjs,ts}',
      'tests/**/*.{js,mjs,cjs,ts,tsx}',
      'src/test/**/*.{js,mjs,cjs,ts,tsx}',
      'playwright/**/*.{js,mjs,cjs,ts,tsx}',
      'e2e/**/*.{js,mjs,cjs,ts,tsx}',
    ],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: testGlobals,
    },
    rules: {
      ...sharedRules,
      'no-undef': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    files: ['public/service-worker.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: serviceWorkerGlobals,
    },
    rules: {
      ...sharedRules,
      'no-undef': 'off',
    },
  },
  {
    files: ['supabase/functions/**/*.{js,ts}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: edgeFunctionGlobals,
    },
    rules: {
      ...sharedRules,
      'no-undef': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
];
