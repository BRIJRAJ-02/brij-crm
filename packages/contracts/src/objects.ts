// A workspace's objects (spec 0005; spec 0012 adds the writes): enough to draw
// the sidebar and open an object's page, nothing about its records, and the
// settings that create, rename, restyle, reorder, archive and restore them.
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { Hue } from './values/hues.ts';
import { ObjectIcon } from './values/object-icons.ts';
import { WorkspaceScoped } from './workspaces.ts';
import { Uuid, uuidV7 } from './values/ids.ts';

/**
 * One object: its id, its address in URLs and the API (`apiSlug`,
 * `people`), its names, its sidebar tile (icon and hue), the template key a
 * standard object carries (`people`, `companies`), the attribute its records
 * are named by, its place in the workspace's order (`position`, the
 * sidebar's), whether it is a standard object, and whether it is archived.
 */
export const ObjectSummary = z.object({
  id: Uuid,
  apiSlug: z.string(),
  singularName: z.string(),
  pluralName: z.string(),
  icon: ObjectIcon,
  hue: Hue,
  standardKey: z.string().optional(),
  primaryAttributeId: Uuid.optional(),
  /** What the caller may do with its records (spec 0009, AC-140): an object they can't see isn't listed. */
  access: z.enum(['read', 'write']),
  /** The workspace's order, every member's sidebar (spec 0012, AC-225). */
  position: z.number().int(),
  /** People, Companies and Deals: only the "Standard" badge reads it; every path is shared (spec 0012). */
  isStandard: z.boolean(),
  /** Archived: out of the sidebar, pickers and create flows; its records stay (spec 0012, AC-226). */
  isArchived: z.boolean(),
});
/** One object, as the navigation and settings show it. */
export type ObjectSummary = z.infer<typeof ObjectSummary>;

/** Which objects to list: the live ones, or (settings) the archived ones too. */
export const ListObjectsInput = WorkspaceScoped.extend({
  includeArchived: z.boolean().optional(),
});
/** Which objects to list. */
export type ListObjectsInput = z.infer<typeof ListObjectsInput>;

/** An object name: 1 to 100 characters, trimmed. */
const ObjectName = z.string().trim().min(1, 'Give a name.').max(100, 'Use at most 100 characters.');

/**
 * A new object (spec 0012, AC-223). `id` is a UUID v7 the browser mints and
 * the retry key: the same request again answers the object already made.
 * `apiSlug` is derived from `pluralName` (`toApiSlug`) when absent; the
 * engine checks its shape and the reserved list (`CONFIG_INVALID` on
 * `apiSlug`). `mutationId` is the write's own uuid, echoed in its event.
 */
export const CreateObjectInput = WorkspaceScoped.extend({
  id: uuidV7('The object id must be a UUID v7.'),
  singularName: ObjectName,
  pluralName: ObjectName,
  apiSlug: z.string().max(100, { error: 'Keep the API name to 100 characters.' }).optional(),
  icon: ObjectIcon,
  hue: Hue,
  mutationId: Uuid,
});
/** A new object. */
export type CreateObjectInput = z.infer<typeof CreateObjectInput>;

/** An object's names and look, changed (AC-224). Its API name never changes. */
export const UpdateObjectInput = WorkspaceScoped.extend({
  objectId: Uuid,
  singularName: ObjectName.optional(),
  pluralName: ObjectName.optional(),
  icon: ObjectIcon.optional(),
  hue: Hue.optional(),
  mutationId: Uuid,
});
/** An object's names and look, changed. */
export type UpdateObjectInput = z.infer<typeof UpdateObjectInput>;

/** An object moved to `position` in the workspace's order (AC-225); the others close up around it. */
export const ReorderObjectInput = WorkspaceScoped.extend({
  objectId: Uuid,
  position: z.number().int().min(0),
  mutationId: Uuid,
});
/** An object moved in the workspace's order. */
export type ReorderObjectInput = z.infer<typeof ReorderObjectInput>;

/** One object to archive or restore (AC-226). */
export const ObjectWriteInput = WorkspaceScoped.extend({
  objectId: Uuid,
  mutationId: Uuid,
});
/** One object to archive or restore. */
export type ObjectWriteInput = z.infer<typeof ObjectWriteInput>;

/**
 * A workspace's objects. `list` answers the live objects in the workspace's
 * order (`position`), and the archived ones after them with
 * `includeArchived`. Every write needs `schema.manage` (403 `FORBIDDEN`) and
 * stores a `definitions` event. `create` refuses `SLUG_TAKEN` (on `apiSlug`),
 * `NAME_TAKEN` (on the name it names), `CONFIG_INVALID` (on its field),
 * `LIMIT_REACHED` and `ID_TAKEN`; `update` refuses `NAME_TAKEN` and
 * `CONFIG_INVALID`; `reorder` answers the whole list in its new order. A non
 * member, or an object they can't see, gets 404 `NOT_FOUND`.
 */
export const objectsContract = {
  list: oc.input(ListObjectsInput).output(z.array(ObjectSummary)),
  create: oc.input(CreateObjectInput).output(ObjectSummary),
  update: oc.input(UpdateObjectInput).output(ObjectSummary),
  reorder: oc.input(ReorderObjectInput).output(z.array(ObjectSummary)),
  archive: oc.input(ObjectWriteInput).output(ObjectSummary),
  restore: oc.input(ObjectWriteInput).output(ObjectSummary),
};
