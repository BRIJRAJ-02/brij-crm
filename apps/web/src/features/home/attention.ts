// Home's Needs attention (spec 0041): open deals the member owns that nobody
// has changed in QUIET_DAYS days, stalest first. The rule is a view's filter
// and sort, so the records engine runs it through the access door and a hidden
// deal is simply absent. Pure: no React and no data layer, so the route's
// loader can build the question.
import type { AttributeDefinition, ObjectSummary, ViewQuery } from '@crm/data';
import { addDays, dayStart } from '../bookings/week.ts';

/** How long a deal may go unchanged before it needs attention. */
export const QUIET_DAYS = 14;

/** How many quiet deals Home lists; the rest are counted. */
export const ATTENTION_SHOWN = 6;

/** What Needs attention reads: the Deals object, the question, and the stage names to show. */
export interface AttentionPlan {
  readonly objectId: string;
  readonly query: ViewQuery;
  /** The stage attribute, read for each row. */
  readonly stageId: string;
  /** Each open stage's label by option id. */
  readonly stages: ReadonlyMap<string, string>;
}

/**
 * The question for the workspace's Deals, or undefined when there is none to
 * ask: no Deals object the member may see, or Deals without an Owner, a Stage
 * or an open stage. `today` is the member's day (`yyyy-MM-dd`): the cut off is
 * that day's midnight less QUIET_DAYS, so the question stays the same all day
 * and two visits share one window.
 */
export function attentionPlan(
  objects: readonly ObjectSummary[],
  attributes: readonly AttributeDefinition[],
  today: string,
): AttentionPlan | undefined {
  const deals = objects.find((object) => object.standardKey === 'deals');
  if (deals === undefined) return undefined;
  const live = attributes.filter((attribute) => attribute.objectId === deals.id && !attribute.isArchived);
  const owner = live.find((attribute) => attribute.apiSlug === 'owner' && attribute.type === 'actor_reference');
  const stage = live.find((attribute) => attribute.apiSlug === 'stage' && attribute.type === 'status');
  const updatedAt = live.find((attribute) => attribute.apiSlug === 'updated_at' && attribute.isSystem);
  if (owner === undefined || stage === undefined || updatedAt === undefined) return undefined;
  const open = (stage.options ?? []).filter(
    (option) => !option.isArchived && (option.outcome === undefined || option.outcome === 'open'),
  );
  if (open.length === 0) return undefined;
  const cutoff = dayStart(addDays(today, -QUIET_DAYS)).toISOString();
  return {
    objectId: deals.id,
    stageId: stage.id,
    stages: new Map(open.map((option) => [option.id, option.label])),
    query: {
      filter: {
        conjunction: 'and',
        conditions: [
          { attributeId: owner.id, operator: 'is_me' },
          { attributeId: stage.id, operator: 'is_any_of', values: open.map((option) => option.id) },
          { attributeId: updatedAt.id, operator: 'before', value: cutoff },
        ],
      },
      sorts: [{ attributeId: updatedAt.id, direction: 'ascending' }],
    },
  };
}
