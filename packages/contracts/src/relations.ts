// Relationships between objects (spec 0014): an admin creates one in a
// dialog, giving each side a name, and renames both sides later. Each side
// is an ordinary record reference attribute, archived and restored through
// `attributes.archive` and `attributes.restore` (spec 0012).
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { AttributeDefinition } from './attributes.ts';
import { Cardinality } from './relationship-block.ts';
import { WorkspaceScoped } from './workspaces.ts';

export { AttributeRelationship, Cardinality } from './relationship-block.ts';

/** A side's name: 1 to 100 characters, trimmed. Its API name comes from it (`toApiSlug`), never typed. */
const SideTitle = z.string().trim().min(1, 'Name this side.').max(100, 'Use at most 100 characters.');

/** One side of a new relationship: the object it sits on and the name its attribute gets there. */
export const NewRelationshipSide = z.object({
  objectId: z.uuid(),
  title: SideTitle,
});
/** One side of a new relationship. */
export type NewRelationshipSide = z.infer<typeof NewRelationshipSide>;

/**
 * A new two way relationship (spec 0014, AC-282). `id` is a UUID v7 the
 * dialog mints once when it opens and the retry key: the same request again
 * answers the relationship already made, whatever its `mutationId`. `from`
 * and `to` may name the same object (a self relationship, whose two names
 * must differ). Each side's API name is `toApiSlug(title, 'attribute')`.
 * One way references are not made here (AC-286).
 */
export const CreateRelationshipInput = WorkspaceScoped.extend({
  id: z.uuid({ version: 'v7', message: 'The relationship id must be a UUID v7.' }),
  cardinality: Cardinality,
  from: NewRelationshipSide,
  to: NewRelationshipSide,
  mutationId: z.uuid(),
});
/** A new two way relationship. */
export type CreateRelationshipInput = z.infer<typeof CreateRelationshipInput>;

/** A side renamed: only its title changes, never its API name. */
const RenamedSide = z.object({ title: SideTitle });

/**
 * New names for one or both sides of a relationship (spec 0014, AC-307).
 * Objects and cardinality never change here (#14 widens cardinality).
 */
export const UpdateRelationshipInput = WorkspaceScoped.extend({
  relationshipId: z.uuid(),
  from: RenamedSide.optional(),
  to: RenamedSide.optional(),
  mutationId: z.uuid(),
});
/** New names for a relationship's sides. */
export type UpdateRelationshipInput = z.infer<typeof UpdateRelationshipInput>;

/** A relationship as a write answers it: its id, cardinality and both sides' definitions. */
export const RelationshipView = z.object({
  relationshipId: z.uuid(),
  cardinality: Cardinality,
  from: AttributeDefinition,
  to: AttributeDefinition,
});
/** A relationship as a write answers it. */
export type RelationshipView = z.infer<typeof RelationshipView>;

/**
 * Relationships. Both writes need `schema.manage` (403 `FORBIDDEN`, nothing
 * written), wait for the server, and store one `definitions` event per
 * object they touched (one for a self relationship). `create` refuses
 * `NOT_FOUND` (an object missing, hidden or archived), `SLUG_TAKEN` on the
 * side's name (`from.title` or `to.title`), `LIMIT_REACHED` (either object
 * full), `ID_TAKEN` and `CONFIG_INVALID` (equal names on a self
 * relationship, on `to.title`); a refused create leaves neither side behind.
 * `update` refuses `NOT_FOUND` (unknown, hidden or archived) and
 * `CONFIG_INVALID` on the side it names.
 */
export const relationshipsContract = {
  create: oc.input(CreateRelationshipInput).output(RelationshipView),
  update: oc.input(UpdateRelationshipInput).output(RelationshipView),
};
