import { accessContract } from './access.ts';
import { attributesContract } from './attributes.ts';
import { meContract } from './me.ts';
import { membersContract } from './members.ts';
import { objectsContract } from './objects.ts';
import { recordsContract } from './records.ts';
import { systemContract } from './system.ts';
import { workspacesContract } from './workspaces.ts';

export * from './access.ts';
export * from './attributes.ts';
export * from './change-event.ts';
export * from './errors.ts';
export * from './me.ts';
export * from './members.ts';
export * from './objects.ts';
export * from './records.ts';
export * from './system.ts';
export * from './values/index.ts';
export * from './workspaces.ts';

/**
 * The one contract the web app, the API and the worker share. Each feature
 * adds its own namespace here. Every procedure outside the bootstrap list
 * (`system.*`, `me.get`, `workspaces.create`, `realtime.connectionToken`)
 * takes `WorkspaceScoped` input and is served behind the API's member door.
 */
export const contract = {
  system: systemContract,
  me: meContract,
  workspaces: workspacesContract,
  objects: objectsContract,
  attributes: attributesContract,
  records: recordsContract,
  members: membersContract,
  access: accessContract,
};
