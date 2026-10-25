import { client } from '@crm/config/eslint';

export default [
  ...client({ root: import.meta.dirname, library: true }),
  // The icon registry and the scoped sets (the editor's, the link page's) are lucide-react's wrapper modules.
  {
    files: ['src/atoms/Icon/icons.ts', 'src/atoms/Icon/editor-icons.ts', 'src/atoms/Icon/link-page-icons.ts'],
    rules: { '@typescript-eslint/no-restricted-imports': 'off' },
  },
  // The artifact build and the screenshot runner are command line tools.
  { files: ['scripts/**'], rules: { 'no-restricted-globals': 'off' } },
];
