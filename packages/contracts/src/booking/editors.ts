// Page and rotation editors (spec 0037, AC-1331, AC-1332): a booking page or a rotation may name up to 20 editors,
// who change everything on it except its editors, its deletion and, for a page, its owner. `editors.list` answers
// the editors to `booking.admin`, the resource's editors and a page's owner; `editors.set` replaces them
// (`booking.admin` only), each person added emailed "You can now edit <name>".
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { Uuid } from '../values/ids.ts';
import { WorkspaceScoped } from '../workspaces.ts';

/** The most editors one page or rotation names (spec 0037's Numbers): past it, 409 `EDITOR_LIMIT`. */
export const EDITORS_MAX = 20;

/** What an editor edits: a booking page or a rotation. */
export const EditorResource = z.enum(['booking_page', 'rotation']);
/** What an editor edits. */
export type EditorResource = z.infer<typeof EditorResource>;

/** One editor as Sharing lists them: a member, by id and name. */
export const EditorView = z.object({
  /** The member's id, which is also the row's key. */
  id: Uuid,
  name: z.string(),
});
/** One editor. */
export type EditorView = z.infer<typeof EditorView>;

/** A resource's editors, and whether the reader may change them (`booking.admin`). */
export const EditorsView = z.object({
  editors: z.array(EditorView),
  canChange: z.boolean(),
});
/** A resource's editors. */
export type EditorsView = z.infer<typeof EditorsView>;

/** Which resource's editors. */
export const ListEditorsInput = WorkspaceScoped.extend({ resourceType: EditorResource, resourceId: Uuid });
/** Which resource's editors. */
export type ListEditorsInput = z.infer<typeof ListEditorsInput>;

/** A resource's editors, replaced: each member once, at most 20 (the server refuses more with `EDITOR_LIMIT`). */
export const SetEditorsInput = WorkspaceScoped.extend({
  resourceType: EditorResource,
  resourceId: Uuid,
  memberIds: z
    .array(Uuid)
    .max(100)
    .refine((list) => new Set(list).size === list.length, { error: 'Add each person once.' }),
  mutationId: Uuid,
});
/** A resource's editors, replaced. */
export type SetEditorsInput = z.infer<typeof SetEditorsInput>;

/** Member procedures for editors. */
export const editorsContract = {
  list: oc.input(ListEditorsInput).output(EditorsView),
  set: oc.input(SetEditorsInput).output(EditorsView),
};
