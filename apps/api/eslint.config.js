import { server } from '@crm/config/eslint';

export default [
  ...server({ root: import.meta.dirname }),
  // Each vendor's one wrapper module (spec 0005): Better Auth, Resend, and the React Email template.
  {
    files: ['src/auth/auth.ts', 'src/mail/resend.ts', 'src/mail/sign-in-code.ts'],
    rules: { '@typescript-eslint/no-restricted-imports': 'off' },
  },
];
