import { client } from '@crm/config/eslint';

export default [
  ...client({ root: import.meta.dirname }),
  // The icon registry is lucide-react's one wrapper module.
  { files: ['src/atoms/Icon/icons.ts'], rules: { '@typescript-eslint/no-restricted-imports': 'off' } },
];
