import { server } from '@crm/config/eslint';

// The sample partner hub (spec 0070): test tooling, never shipped. Its server is the one file that calls out.
export default server({ root: import.meta.dirname, fetchWrappers: ['server.ts'] });
