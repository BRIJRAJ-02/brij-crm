import { client } from '@crm/config/eslint';

export default [
  ...client({ root: import.meta.dirname, library: true }),
  // The icon registry is lucide-react's one wrapper module.
  { files: ['src/atoms/Icon/icons.ts'], rules: { '@typescript-eslint/no-restricted-imports': 'off' } },
  // The artifact build and the screenshot runner are command line tools.
  { files: ['scripts/**'], rules: { 'no-restricted-globals': 'off' } },
];
