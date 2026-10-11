import { server } from '@crm/config/eslint';

// The load harness (spec 0011): it may import the load scripts' guards and files from @crm/core, never minting.
export default server({ root: import.meta.dirname, loadHarness: true });
