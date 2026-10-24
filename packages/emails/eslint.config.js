import { server } from '@crm/config/eslint';

export default server({
  root: import.meta.dirname,
  // React Email in its one wrapper module (spec 0001's packages/emails); every template draws through it.
  // `render` comes from @react-email/render, which declares it; react-email re-exports it without a type.
  vendorWrappers: [{ files: ['src/react-email.ts'], allow: ['react-email', '@react-email/render'] }],
});
