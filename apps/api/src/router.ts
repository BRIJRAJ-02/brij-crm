import { systemRouter } from './modules/system/router.ts';
import { base } from './orpc.ts';

// One module per feature under ./modules, each implementing its contract namespace.
export const router = base.router({
  system: systemRouter,
});
