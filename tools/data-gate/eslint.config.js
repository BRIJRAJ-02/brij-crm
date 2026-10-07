import { client } from '@crm/config/eslint';

// The AC-40 gate: a browser harness and the Node script that drives it.
export default client({ root: import.meta.dirname });
