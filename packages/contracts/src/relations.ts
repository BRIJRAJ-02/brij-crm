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
import { RecordRefDisplay } from './values/options.ts';
import { WorkspaceScoped } from './workspaces.ts';
import { Uuid, uuidV7 } from './values/ids.ts';

export { AttributeRelationship, Cardinality } from './relationship-block.ts';

/** A side's name: 1 to 100 characters, trimmed. Its API name comes from it (`toApiSlug`), never typed. */
const SideTitle = z.string().trim().min(1, 'Name this side.').max(100, 'Use at most 100 characters.');

/** One side of a new relationship: the object it sits on and the name its attribute gets there. */
export const NewRelationshipSide = z.object({
  objectId: Uuid,
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
  id: uuidV7('The relationship id must be a UUID v7.'),
  cardinality: Cardinality,
  from: NewRelationshipSide,
  to: NewRelationshipSide,
  mutationId: Uuid,
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
  relationshipId: Uuid,
  from: RenamedSide.optional(),
  to: RenamedSide.optional(),
  mutationId: Uuid,
});
/** New names for a relationship's sides. */
export type UpdateRelationshipInput = z.infer<typeof UpdateRelationshipInput>;

/** A relationship as a write answers it: its id, cardinality and both sides' definitions. */
export const RelationshipView = z.object({
  relationshipId: Uuid,
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
  objectId: Uuid,
  recordId: Uuid,
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
  recordId: Uuid,
  attributeId: Uuid,
  // Twice the cap, so a call a little over it answers the engine's own refusal, and junk stops at parsing.
  targets: z
    .array(LinkTarget)
    .min(1, 'Pick a record to link.')
    .max(LINKS_PER_CALL * 2, `Link at most ${String(LINKS_PER_CALL)} records at a time.`),
  move: z.boolean().optional(),
  baseVersionId: Uuid.nullable().optional(),
  mutationId: Uuid,
});
/** Links to add on one side of one record. */
export type AddLinksInput = z.infer<typeof AddLinksInput>;

/** Links to remove from one side of one record, by far record id (1 to 100). */
export const RemoveLinksInput = WorkspaceScoped.extend({
  recordId: Uuid,
  attributeId: Uuid,
  targetRecordIds: z
    .array(Uuid)
    .min(1, 'Pick a record to unlink.')
    .max(LINKS_PER_CALL * 2, `Unlink at most ${String(LINKS_PER_CALL)} records at a time.`),
  mutationId: Uuid,
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
  written: z.record(z.uuid(), Uuid),
  changedRecordIds: z.array(Uuid),
  replaced: z.object({ versionId: Uuid, setBy: ActorReferenceValue }).optional(),
  echoes: z.number().int().min(0),
});
/** What a link write answers. */
export type LinksWritten = z.infer<typeof LinksWritten>;

/** The most related records one `links.page` answers (spec 0014). */
export const LINK_PAGE_MAX = 50;
/** How many related records a record page's section shows at first, and adds with each "Show more" (spec 0014). */
export const LINK_PREVIEW = 20;

/**
 * A page of the records linked on one side of one record (spec 0014,
 * milestone 3; spec 0017's related sections): `limit` 1 to 50 (20 when left
 * out), after `cursor` (the last page's `nextCursor`, bound to this record and
 * side).
 */
export const PageLinksInput = WorkspaceScoped.extend({
  recordId: Uuid,
  attributeId: Uuid,
  cursor: z.string().min(1).max(512).optional(),
  limit: z.number().int().min(1).max(LINK_PAGE_MAX).optional(),
});
/** A page of one side's linked records to read. */
export type PageLinksInput = z.infer<typeof PageLinksInput>;

/**
 * One page of a side's linked records, in that side's order (position, then
 * when each link began), as display shapes only (never record bodies): the
 * live far records the reader may see, the cursor for the next page when
 * there are more, and `total`, the exact count of them all.
 */
export const LinkPage = z.object({
  items: z.array(RecordRefDisplay),
  nextCursor: z.string().optional(),
  total: z.number().int().min(0),
});
/** A page of one side's linked records. */
export type LinkPage = z.infer<typeof LinkPage>;

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
 * of one, more than 100), `ATTRIBUTE_READ_ONLY` and `VALUE_REQUIRED`. `page`
 * (milestone 3) reads one side's linked records a page at a time: 404
 * `NOT_FOUND` for a record or side unknown, hidden, in the trash or archived,
 * and 400 `INPUT_INVALID` on `cursor` for a cursor that isn't this side's.
 */
export const linksContract = {
  add: oc.input(AddLinksInput).output(LinksWritten),
  remove: oc.input(RemoveLinksInput).output(LinksWritten),
  page: oc.input(PageLinksInput).output(LinkPage),
};
