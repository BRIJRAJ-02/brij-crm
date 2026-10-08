import { accessRouter } from './modules/access/router.ts';
import { attributesRouter } from './modules/attributes/router.ts';
import { meRouter } from './modules/me/router.ts';
import { membersRouter } from './modules/members/router.ts';
import { objectsRouter } from './modules/objects/router.ts';
import { recordsRouter } from './modules/records/router.ts';
import { systemRouter } from './modules/system/router.ts';
import { workspacesRouter } from './modules/workspaces/router.ts';
import { base } from './orpc.ts';

// One module per feature under ./modules, each implementing its contract namespace.
export const router = base.router({
  system: systemRouter,
  me: meRouter,
  workspaces: workspacesRouter,
  objects: objectsRouter,
  attributes: attributesRouter,
  records: recordsRouter,
  members: membersRouter,
  access: accessRouter,
});
