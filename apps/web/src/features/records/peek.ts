// The record panel's reads (the peek beside a table or board, spec 0017
// AC-384; spec 0074, AC-7413): the same subscriptions the record page's loader
// opens, through the data layer, for one record. The table already holds the
// record's body, so the record and its details draw at once with no read;
// each section arrives as its own read lands. Loaded with the view's screen,
// never in the first load.
import type {
  ActivityFeed,
  AttributeDefinition,
  DataLayer,
  NoteList,
  ObjectSummary,
  RecordComments,
  RecordFilesSource,
  RecordSubscription,
  TaskList,
} from '@crm/data';
import { detailAttributes, relatedSides } from './details.ts';
import type { RelatedSource } from './RelatedSections.tsx';

/**
 * What the panel draws at once (spec 0074, AC-7413): the record, served from the store a table or board already keeps
 * fresh (no read for it, AC-7425), with the attributes Details lists, the objects its links name and who the person is.
 * Each comes from a cache or the store, so it lands in a moment.
 */
export interface PeekCore {
  readonly recordId: string;
  /** The workspace's objects, so the records the timeline and tasks name link to their pages. */
  readonly objects: readonly ObjectSummary[];
  /** The attributes Details lists. */
  readonly attributes: readonly AttributeDefinition[];
  /** The person's member id: a new task is theirs, and their own comments can be changed. */
  readonly meId: string | undefined;
  readonly record: RecordSubscription;
}

/** Each section's source, as its read lands; undefined until then, so the section draws its own Skeleton. */
export interface PeekParts {
  readonly recordId: string;
  readonly related?: readonly RelatedSource[];
  readonly feed?: ActivityFeed;
  readonly open?: TaskList;
  readonly notes?: NoteList;
  readonly comments?: RecordComments;
  readonly files?: RecordFilesSource;
  /** A section whose read failed: the panel says so in that section, with Try again. */
  readonly failed?: true;
}

/** The record and what the panel draws at once, from the caches and the store (AC-7413). */
export async function openPeekCore(
  data: DataLayer,
  slug: string,
  attributes: readonly AttributeDefinition[],
  recordId: string,
): Promise<PeekCore> {
  const shown = detailAttributes(attributes);
  const [objects, access, record] = await Promise.all([
    data.objects.list(slug),
    data.access.mine(slug).catch(() => undefined),
    data.records.one(
      slug,
      recordId,
      shown.map((attribute) => attribute.id),
    ),
  ]);
  return { recordId, objects, attributes: shown, meId: access?.memberId, record };
}

/**
 * Opens each section's subscription on its own, as the record page's route does for its page, handing each to `take`
 * as it lands, so no section waits on the slowest read (AC-7413). The caller drops a late source for a record it has
 * stepped past. The tabs' counts read their first pages as the panel
 * retains them (never here: a step the panel skipped past would leave those lists read and held with nobody showing
 * them).
 */
export function openPeekParts(
  data: DataLayer,
  slug: string,
  object: ObjectSummary,
  attributes: readonly AttributeDefinition[],
  recordId: string,
  take: (part: Omit<PeekParts, 'recordId'>) => void,
): void {
  const failed = () => take({ failed: true });
  void data.activity.forRecord(slug, recordId, object.id).then((feed) => take({ feed }), failed);
  void data.tasks.forRecord(slug, recordId, 'open', object.id).then((open) => take({ open }), failed);
  void data.notes.forRecord(slug, recordId, object.id).then((notes) => take({ notes }), failed);
  void data.comments.forRecord(slug, recordId).then((comments) => take({ comments }), failed);
  void data.files.forRecord(slug, recordId).then((files) => take({ files }), failed);
  void data.objects
    .list(slug)
    .then((objects) => {
      const sides = relatedSides(attributes, objects);
      return Promise.all(
        sides.map((side) =>
          data.links
            .section(slug, {
              recordId,
              objectId: object.id,
              attributeId: side.attribute.id,
              farObjectIds: side.attribute.relationship?.targetObjectIds ?? [side.farObject.id],
              ...(side.farObject.primaryAttributeId === undefined
                ? {}
                : { farNameAttributeIds: [side.farObject.primaryAttributeId] }),
            })
            .then((section) => ({ ...side, section })),
        ),
      );
    })
    .then((related) => take({ related }), failed);
}
