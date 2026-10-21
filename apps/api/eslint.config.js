import { server } from '@crm/config/eslint';

export default server({
  root: import.meta.dirname,
  // Each vendor's one wrapper module may import its own entries and nothing else of any vendor.
  vendorWrappers: [
    // Monitoring (spec 0010, AC-184). instrument.ts imports startSentry from ./sentry.ts, never a vendor.
    { files: ['src/monitoring/sentry.ts'], allow: ['@sentry/node'] },
    { files: ['src/monitoring/posthog.ts'], allow: ['posthog-node'] },
    // Sign in and mail (spec 0005). The templates live in packages/emails, its one React Email wrapper.
    { files: ['src/auth/auth.ts'], allow: ['better-auth', 'better-auth/api', 'better-auth/plugins/email-otp'] },
    { files: ['src/mail/resend.ts'], allow: ['resend'] },
    // A booking's emails (spec 0025) still draw with React Email here, until they move to packages/emails.
    { files: ['src/mail/booking.ts'], allow: ['react-email'] },
    // The job runners (spec 0008): Graphile Worker only here.
    { files: ['src/jobs/graphile.ts'], allow: ['graphile-worker'] },
  ],
});
