import { client } from '@crm/config/eslint';

export default client({
  root: import.meta.dirname,
  collaboration: true,
  // Sign in's one wrapper (spec 0005): only src/auth/ imports Better Auth, and
  // only its browser client; the server library stays refused there too.
  vendorWrappers: [{ files: ['src/auth/**'], allow: ['better-auth/client', 'better-auth/client/*'] }],
});
