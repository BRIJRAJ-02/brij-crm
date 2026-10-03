// A workspace's objects as the app's navigation sees them (spec 0005): enough
// to draw the sidebar and open an object's page, nothing about its records.
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { Hue } from './values/hues.ts';
import { ObjectIcon } from './values/object-icons.ts';
import { WorkspaceScoped } from './workspaces.ts';

/**
 * One live object: its id, its address in URLs and the API (`apiSlug`,
 * `people`), its names, its sidebar tile (icon and hue), the template key a
 * standard object carries (`people`, `companies`), and the attribute its
 * records are named by.
 */
export const ObjectSummary = z.object({
  id: z.uuid(),
  apiSlug: z.string(),
  singularName: z.string(),
  pluralName: z.string(),
  icon: ObjectIcon,
  hue: Hue,
  standardKey: z.string().optional(),
  primaryAttributeId: z.uuid().optional(),
});
/** One live object, as the navigation shows it. */
export type ObjectSummary = z.infer<typeof ObjectSummary>;

/**
 * A workspace's objects. `list` answers the live (unarchived) objects in the
 * order they were made, which puts the standard ones in template order. A
 * non member gets the same 404 `NOT_FOUND` as an unknown workspace.
 */
export const objectsContract = {
  list: oc.input(WorkspaceScoped).output(z.array(ObjectSummary)),
};
