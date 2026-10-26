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
    // Form file uploads (#32): Vercel Blob only here.
    { files: ['src/storage/blob.ts'], allow: ['@vercel/blob'] },
    // The job runners (spec 0008): Graphile Worker only here.
    { files: ['src/jobs/graphile.ts'], allow: ['graphile-worker'] },
  ],
  // Spec 0055, AC-5531: every read of an address a person typed goes through src/public/outside.ts, which checks
  // where it goes. These are the only files that call the network at all. Each of the others reaches a fixed
  // address — our own services, or one provider's API — from the environment or a constant, never one a person
  // could choose, so none of them needs the address checks and none of them may grow a case that does.
  fetchWrappers: [
    // The one outside fetch: an address from a person reaches the network only here.
    'src/public/outside.ts',
    // Our own services, at addresses the environment gives.
    'src/realtime/centrifugo.ts',
    'src/realtime/signed-out.ts',
    'src/realtime/wake.ts',
    'src/mail/mailpit.ts',
    // The pass's band, drawn by this deployment's own picture route: the origin comes from the environment and
    // the handle is the caller's own, checked against `HANDLE_PATTERN` before the route reaches the door.
    'src/wallet/wallet.ts',
    // One provider's API, at its own constant addresses.
    'src/auth/google-photo.ts',
    'src/calendar/google.ts',
    'src/calendar/microsoft.ts',
    'src/forms/recaptcha.ts',
    // A test stands in for the network rather than reaching it.
    '**/*.test.ts',
    'test/**',
  ],
});
