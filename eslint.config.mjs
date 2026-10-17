import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

// Only the checks TypeScript can't make: React's rules of hooks (a hook
// after an early return breaks a component only when it re-renders). The
// code's style is left to the code.
export default [
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    languageOptions: { parser: tseslint.parser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
    },
    // Comments that turn off rules this config doesn't use are fine.
    linterOptions: { reportUnusedDisableDirectives: 'off' },
  },
];
