import { meRouter } from './modules/me/router.ts';
import { objectsRouter } from './modules/objects/router.ts';
import { systemRouter } from './modules/system/router.ts';
import { workspacesRouter } from './modules/workspaces/router.ts';
import { base } from './orpc.ts';

// One module per feature under ./modules, each implementing its contract namespace.
export const router = base.router({
  system: systemRouter,
  me: meRouter,
  workspaces: workspacesRouter,
  objects: objectsRouter,
});
