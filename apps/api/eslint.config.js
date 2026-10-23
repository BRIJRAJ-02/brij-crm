import { server } from '@crm/config/eslint';

export default server({
  root: import.meta.dirname,
  // Each vendor's one wrapper module may import its own entries and nothing else of any vendor.
  vendorWrappers: [
    // Monitoring (spec 0010, AC-184). instrument.ts imports startSentry from ./sentry.ts, never a vendor.
    { files: ['src/monitoring/sentry.ts'], allow: ['@sentry/node'] },
    { files: ['src/monitoring/posthog.ts'], allow: ['posthog-node'] },
    // Sign in and mail (spec 0005). The templates live in packages/emails, its one React Email wrapper.
    // Two factor (spec 0033): its plugin, and the cookie and crypto helpers its held back sign in needs.
    // Sync Google photo (23 Oct 2026): oauth2's decryptOAuthToken reads the link's access token back.
    {
      files: ['src/auth/auth.ts'],
      allow: [
        'better-auth',
        'better-auth/api',
        'better-auth/cookies',
        'better-auth/crypto',
        'better-auth/oauth2',
        'better-auth/plugins/email-otp',
        'better-auth/plugins/two-factor',
      ],
    },
    { files: ['src/mail/resend.ts'], allow: ['resend'] },
    // The job runners (spec 0008): Graphile Worker only here.
    { files: ['src/jobs/graphile.ts'], allow: ['graphile-worker'] },
  ],
});
