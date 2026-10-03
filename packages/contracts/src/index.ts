import { meContract } from './me.ts';
import { objectsContract } from './objects.ts';
import { systemContract } from './system.ts';
import { workspacesContract } from './workspaces.ts';

export * from './errors.ts';
export * from './me.ts';
export * from './objects.ts';
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
};
