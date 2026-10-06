import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/',
      'node_modules/',
      'test-results/',
      'playwright-report/',
      'eslint.config.js',
      'scripts/',
    ],
  },
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // The dashboard runs in the browser: Node types exist only for tests, e2e and config files.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/test/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['node:*'], message: 'Browser code: no Node modules.' }] },
      ],
      'no-restricted-globals': ['error', 'process', 'Buffer', 'require', '__dirname', '__filename', 'global'],
    },
  },
);
