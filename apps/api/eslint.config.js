import { server } from '@crm/config/eslint';

export default server({
  root: import.meta.dirname,
  // Each vendor's one wrapper module may import its own entries and nothing else of any vendor.
  vendorWrappers: [
    // Monitoring (spec 0010, AC-184). instrument.ts imports startSentry from ./sentry.ts, never a vendor.
    { files: ['src/monitoring/sentry.ts'], allow: ['@sentry/node'] },
    { files: ['src/monitoring/posthog.ts'], allow: ['posthog-node'] },
    // Sign in, mail and the React Email template (spec 0005).
    { files: ['src/auth/auth.ts'], allow: ['better-auth', 'better-auth/api', 'better-auth/plugins/email-otp'] },
    { files: ['src/mail/resend.ts'], allow: ['resend'] },
    { files: ['src/mail/sign-in-code.ts'], allow: ['react-email'] },
  ],
});
