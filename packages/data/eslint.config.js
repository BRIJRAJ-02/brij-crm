import { client } from '@crm/config/eslint';

export default client({
  root: import.meta.dirname,
  collaboration: true,
  // Sign in's one wrapper (spec 0005): only src/auth/ imports Better Auth, and
  // only its browser client; the server library stays refused there too.
  // Centrifugo's browser client has its one wrapper too (live updates): src/live/centrifuge.ts.
  vendorWrappers: [
    { files: ['src/auth/**'], allow: ['better-auth/client', 'better-auth/client/*'] },
    { files: ['src/live/centrifuge.ts'], allow: ['centrifuge'] },
  ],
});
