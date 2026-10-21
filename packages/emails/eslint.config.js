import { server } from '@crm/config/eslint';

export default server({
  root: import.meta.dirname,
  // React Email in its one wrapper module (spec 0001's packages/emails); every template draws through it.
  vendorWrappers: [{ files: ['src/react-email.ts'], allow: ['react-email'] }],
});
