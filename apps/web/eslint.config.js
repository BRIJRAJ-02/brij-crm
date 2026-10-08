import { screens } from '@crm/config/eslint';

export default screens({
  root: import.meta.dirname,
  // Monitoring's wrappers (spec 0010, AC-184): each may import its own vendor entry and nothing else.
  vendorWrappers: [
    { files: ['src/monitoring/sentry.ts'], allow: ['@sentry/react'] },
    { files: ['vite.config.ts'], allow: ['@sentry/vite-plugin'] },
  ],
});
