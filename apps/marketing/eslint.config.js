import { client } from '@crm/config/eslint';

export default [
  // The SSR bundle (package.json `build`), deleted after the prerender, is never source.
  { ignores: ['dist-ssr/**'] },
  ...client({ root: import.meta.dirname }),
];
