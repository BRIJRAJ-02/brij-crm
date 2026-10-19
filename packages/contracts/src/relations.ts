// Relationships between objects (spec 0014): an admin creates one in a
// dialog, giving each side a name, and renames both sides later. Each side
// is an ordinary record reference attribute, archived and restored through
// `attributes.archive` and `attributes.restore` (spec 0012).
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { AttributeDefinition } from './attributes.ts';
import { RecordView } from './records.ts';
import { Cardinality } from './relationship-block.ts';
import { ActorReferenceValue } from './values/attribute-values.ts';
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

/** The most far records one `links.add` or `links.remove` names (spec 0014, AC-294). */
export const LINKS_PER_CALL = 100;

/** A far record to link: its object and its id. */
export const LinkTarget = z.object({
  objectId: z.uuid(),
  recordId: z.uuid(),
});
/** A far record to link. */
export type LinkTarget = z.infer<typeof LinkTarget>;

/**
 * Links to add on one side of one record (spec 0014, AC-290 to AC-293): 1 to
 * 100 far records, exactly one on a side that holds one (which replaces its
 * link). `move` takes a picked record from the record holding it on a far
 * side that holds one ("At Acme"); without it such a pick is refused
 * `RELATIONSHIP_TAKEN`. `baseVersionId` (a side that holds one) is the link
 * version the browser held when the edit began, `null` when it held none, so
 * the answer can say which save it replaced (AC-295).
 */
export const AddLinksInput = WorkspaceScoped.extend({
  recordId: z.uuid(),
  attributeId: z.uuid(),
  // Twice the cap, so a call a little over it answers the engine's own refusal, and junk stops at parsing.
  targets: z
    .array(LinkTarget)
    .min(1, 'Pick a record to link.')
    .max(LINKS_PER_CALL * 2, `Link at most ${String(LINKS_PER_CALL)} records at a time.`),
  move: z.boolean().optional(),
  baseVersionId: z.uuid().nullable().optional(),
  mutationId: z.uuid(),
});
/** Links to add on one side of one record. */
export type AddLinksInput = z.infer<typeof AddLinksInput>;

/** Links to remove from one side of one record, by far record id (1 to 100). */
export const RemoveLinksInput = WorkspaceScoped.extend({
  recordId: z.uuid(),
  attributeId: z.uuid(),
  targetRecordIds: z
    .array(z.uuid())
    .min(1, 'Pick a record to unlink.')
    .max(LINKS_PER_CALL * 2, `Unlink at most ${String(LINKS_PER_CALL)} records at a time.`),
  mutationId: z.uuid(),
});
/** Links to remove from one side of one record. */
export type RemoveLinksInput = z.infer<typeof RemoveLinksInput>;

/**
 * What a link write answers: the near record fresh (its side as reads give
 * it: the first 20 links of a side that holds many, and `linkTotals`), the
 * version the write made for the side (`written`, empty when nothing
 * changed), every other record it changed (`changedRecordIds`: far records
 * and moved links' old holders, for the browser to read again), the save a
 * side of one replaced (`replaced`), and `echoes`, how many change events
 * carry the write's `mutationId` (one per object it touched, 0 when it
 * changed nothing).
 */
export const LinksWritten = z.object({
  record: RecordView,
  written: z.record(z.uuid(), z.uuid()),
  changedRecordIds: z.array(z.uuid()),
  replaced: z.object({ versionId: z.uuid(), setBy: ActorReferenceValue }).optional(),
  echoes: z.number().int().min(0),
});
/** What a link write answers. */
export type LinksWritten = z.infer<typeof LinksWritten>;

/**
 * Links (spec 0014, milestone 2): a side that holds many changes only through
 * these, one delta at a time; nothing else on the side is rewritten. Both
 * need `write` on the near side and every far record (and a moved link's old
 * holder) visible to the caller. A link already there, or one not there to
 * remove, changes nothing and succeeds. Refusals: 404 `NOT_FOUND` (the
 * record, the side, or a far record unknown or hidden; a far record of an
 * archived object; a side spec 0012 counts as archived), 409
 * `RELATIONSHIP_TAKEN` (naming the record picked) and `RECORD_DELETED`, 422
 * `ATTRIBUTE_VALUE_INVALID` (another object, the record itself, two on a side
 * of one, more than 100), `ATTRIBUTE_READ_ONLY` and `VALUE_REQUIRED`.
 */
export const linksContract = {
  add: oc.input(AddLinksInput).output(LinksWritten),
  remove: oc.input(RemoveLinksInput).output(LinksWritten),
};
