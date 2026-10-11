import { server } from '@crm/config/eslint';

// The load harness (spec 0011): it may import the load scripts' guards and files from @crm/core, never minting.
// Centrifugo's client has its one wrapper here too (milestone 3, live delivery): src/live/centrifuge.ts, with `ws`.
export default server({
  root: import.meta.dirname,
  loadHarness: true,
  vendorWrappers: [{ files: ['src/live/centrifuge.ts'], allow: ['centrifuge'] }],
});
