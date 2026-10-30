// The record panel's reads (the peek beside a table or board, spec 0017
// AC-384): the same subscriptions the record page's loader opens, through the
// data layer, for one record. The table already holds the record's body, so
// its details show at once; the rest arrive as they load. Loaded with the
// view's screen, never in the first load.
import type {
  ActivityFeed,
  AttributeDefinition,
  DataLayer,
  NoteList,
  ObjectSummary,
  RecordComments,
  RecordSubscription,
  TaskList,
} from '@crm/data';
import { detailAttributes, relatedSides } from './details.ts';
import type { RelatedSource } from './RelatedSections.tsx';

/** What the panel shows for one record, each a subscription its tab reads. */
export interface PeekSources {
  readonly recordId: string;
  /** The workspace's objects, so the records the timeline and tasks name link to their pages. */
  readonly objects: readonly ObjectSummary[];
  /** The attributes Details lists. */
  readonly attributes: readonly AttributeDefinition[];
  readonly related: readonly RelatedSource[];
  /** The person's member id: a new task is theirs, and their own comments can be changed. */
  readonly meId: string | undefined;
  readonly record: RecordSubscription;
  readonly feed: ActivityFeed;
  readonly open: TaskList;
  readonly notes: NoteList;
  readonly comments: RecordComments;
}

/** Opens one record's subscriptions for the panel, as the record page's route does for its page. */
export async function openPeek(
  data: DataLayer,
  slug: string,
  object: ObjectSummary,
  attributes: readonly AttributeDefinition[],
  recordId: string,
): Promise<PeekSources> {
  const shown = detailAttributes(attributes);
  const [objects, access] = await Promise.all([data.objects.list(slug), data.access.mine(slug).catch(() => undefined)]);
  const sides = relatedSides(attributes, objects);
  const [record, feed, open, notes, comments, sections] = await Promise.all([
    data.records.one(
      slug,
      recordId,
      shown.map((attribute) => attribute.id),
    ),
    data.activity.forRecord(slug, recordId, object.id),
    data.tasks.forRecord(slug, recordId, 'open', object.id),
    data.notes.forRecord(slug, recordId, object.id),
    data.comments.forRecord(slug, recordId),
    Promise.all(
      sides.map((side) =>
        data.links.section(slug, {
          recordId,
          objectId: object.id,
          attributeId: side.attribute.id,
          farObjectIds: side.attribute.relationship?.targetObjectIds ?? [side.farObject.id],
          ...(side.farObject.primaryAttributeId === undefined
            ? {}
            : { farNameAttributeIds: [side.farObject.primaryAttributeId] }),
        }),
      ),
    ),
  ]);
  const related = sides.flatMap((side, index) => {
    const section = sections[index];
    return section === undefined ? [] : [{ ...side, section }];
  });
  // The tabs' counts read their first pages as the panel retains them (never here: a step the panel skipped past
  // would leave those lists read and held with nobody showing them).
  return {
    recordId,
    objects,
    attributes: shown,
    related,
    meId: access?.memberId,
    record,
    feed,
    open,
    notes,
    comments,
  };
}
