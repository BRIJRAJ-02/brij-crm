import { server } from '@crm/config/eslint';

export default [
  ...server({
    root: import.meta.dirname,
    // Monitoring's wrappers (spec 0010, AC-184): each may import its own vendor entry and nothing else.
    // instrument.ts imports startSentry from ./sentry.ts, never a vendor.
    vendorWrappers: [
      { files: ['src/monitoring/sentry.ts'], allow: ['@sentry/node'] },
      { files: ['src/monitoring/posthog.ts'], allow: ['posthog-node'] },
    ],
  }),
  // Each vendor's one wrapper module (spec 0005): Better Auth, Resend, and the React Email template.
  {
    files: ['src/auth/auth.ts', 'src/mail/resend.ts', 'src/mail/sign-in-code.ts'],
    rules: { '@typescript-eslint/no-restricted-imports': 'off' },
  },
];
