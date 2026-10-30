// Lists (spec 0048): a working set of one object's records, such as a Sales
// pipeline over Deals. A list follows its object's access (decision 2), and
// members with `lists.manage` make their own (decision 1).
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { Hue } from './values/hues.ts';
import { ObjectIcon } from './values/object-icons.ts';
import { WorkspaceScoped } from './workspaces.ts';
import { Uuid, uuidV7 } from './values/ids.ts';

/** The most lists one workspace holds, archived ones included (spec 0004 limits, AC-4805). */
export const MAX_LISTS = 500;

/**
 * What a new list starts as (decision 4): Blank (one table view) or Pipeline
 * (a Stage status field and an Owner member field, and a board grouped by
 * Stage as its default view).
 */
export const LIST_TEMPLATES = ['blank', 'pipeline'] as const;

/** What a new list starts as. */
export const ListTemplate = z.enum(LIST_TEMPLATES);
/** What a new list starts as. */
export type ListTemplate = z.infer<typeof ListTemplate>;

/**
 * One list as the sidebar, the list page and settings show it: its id and
 * object, its address in URLs (`apiSlug`, never changing after it is made),
 * its name and tile, whether each record goes in once (`allowsDuplicates`
 * false), the view everyone lands on, who made it, and what the caller may do:
 * `canWrite` (add, edit and remove entries: write on the object) and
 * `canManage` (change the list and its fields: `schema.manage`, or its maker
 * with `lists.manage`). `entryCount` is the stored count, sent only to a caller
 * no record rule limits (decision 13).
 */
export const ListView = z.object({
  id: Uuid,
  objectId: Uuid,
  apiSlug: z.string(),
  name: z.string(),
  icon: ObjectIcon,
  hue: Hue,
  allowsDuplicates: z.boolean(),
  isArchived: z.boolean(),
  defaultViewId: Uuid.optional(),
  createdByMemberId: Uuid.optional(),
  canWrite: z.boolean(),
  canManage: z.boolean(),
  entryCount: z.number().int().min(0).optional(),
});
/** One list. */
export type ListView = z.infer<typeof ListView>;

/** Which lists to read: the live ones the caller may read, or (settings) the archived ones too. */
export const ListListsInput = WorkspaceScoped.extend({ includeArchived: z.boolean().optional() });
/** Which lists to read. */
export type ListListsInput = z.infer<typeof ListListsInput>;

/** A list's name: 1 to 100 characters, trimmed (spec 0012's name rules). */
export const ListName = z.string().trim().min(1, 'Give the list a name.').max(100, 'Use at most 100 characters.');

/**
 * A new list (AC-4801): a UUID v7 the browser mints (the retry key: the same
 * create again answers the list already made), its object, its name, its tile
 * (the `list` icon and the next free hue when absent), what it starts as, and
 * whether a record may go in more than once (no, unless asked: decision 3).
 */
export const CreateListInput = WorkspaceScoped.extend({
  id: uuidV7('The list id must be a UUID v7.'),
  objectId: Uuid,
  name: ListName,
  icon: ObjectIcon.optional(),
  hue: Hue.optional(),
  template: ListTemplate,
  allowsDuplicates: z.boolean().optional(),
  mutationId: Uuid,
});
/** A new list. */
export type CreateListInput = z.infer<typeof CreateListInput>;

/**
 * A list's settings (AC-4829): any of its name, tile and the once only rule.
 * Turning "Each record once" on while a record has two live entries is
 * `CONFIG_INVALID` (AC-4830).
 */
export const UpdateListInput = WorkspaceScoped.extend({
  listId: Uuid,
  name: ListName.optional(),
  icon: ObjectIcon.optional(),
  hue: Hue.optional(),
  allowsDuplicates: z.boolean().optional(),
  mutationId: Uuid,
});
/** A list's settings. */
export type UpdateListInput = z.infer<typeof UpdateListInput>;

/** One list to archive or restore (AC-4831). */
export const ListIdInput = WorkspaceScoped.extend({ listId: Uuid, mutationId: Uuid });
/** One list to archive or restore. */
export type ListIdInput = z.infer<typeof ListIdInput>;

/**
 * A workspace's lists. `list` answers the live lists the caller may read (a
 * list whose object they can't see is absent), oldest first, and the archived
 * ones after them with `includeArchived`. `create` needs `lists.manage` and
 * write on the object (403 `FORBIDDEN`), and refuses `CONFIG_INVALID` for a
 * name another list holds ignoring case ("A list named <Name> already
 * exists."), `LIMIT_REACHED` past 500 lists, and `NOT_FOUND` for an object
 * the caller can't see or that is archived. It stores a `definitions` event
 * naming the list. `update`, `archive` and `restore` are for the list's
 * managers (`schema.manage`, or its maker with `lists.manage`; anyone else gets
 * 403 `FORBIDDEN` naming who may) and each stores a `definitions` event naming
 * the list; an archived list refuses `update` and entry writes.
 */
export const listsContract = {
  list: oc.input(ListListsInput).output(z.array(ListView)),
  create: oc.input(CreateListInput).output(ListView),
  update: oc.input(UpdateListInput).output(ListView),
  archive: oc.input(ListIdInput).output(ListView),
  restore: oc.input(ListIdInput).output(ListView),
};
