// Who may read a live event (spec 0009, Live events): `filterEvent` cuts one
// outbox row to what an audience (members with equal data policies) may
// receive, by the rule for its kind, and `eventFacts` says which facts a row
// needs loaded first. Pure: the relay (spec 0007) loads the facts once per
// batch and sends the stub when nothing is left; catch up skips such a row.
//
// The row is spec 0007's `ChangeEvent` (`@crm/contracts`) without the stub,
// plus what the outbox stores and never publishes: a job's starter
// (`actor_member_id`), read here for the `jobs` rule.
import type { ChangeEvent, Permission, ReplacedEntry } from '@crm/contracts';
import { fieldLevel, objectLevel, OPEN_KEY, recordRule, type DataPolicy } from './policy.ts';

export type { ReplacedEntry };

/** An event as an audience receives it: every kind of `ChangeEvent` but the stub, which the relay makes. */
export type AudienceEvent = Exclude<ChangeEvent, { kind: 'restricted' }>;

/** One outbox row as the relay reads it, by kind: the published event, and for `jobs` the job's starter. */
export type EventRow =
  | Exclude<AudienceEvent, { kind: 'jobs' }>
  | (Extract<AudienceEvent, { kind: 'jobs' }> & {
      /** The job's starter: read here, never published. */
      readonly actorMemberId?: string;
    });

/** Every kind of event, each with a rule here. */
export const EVENT_KINDS = [
  'records',
  'entries',
  'definitions',
  'views',
  'notes',
  'tasks',
  'members',
  'access',
  'jobs',
] as const satisfies readonly EventRow['kind'][];

/** One member of an audience: who, and what they may do. */
export interface AudienceMember {
  readonly memberId: string;
  readonly userId?: string;
  readonly permissions: readonly Permission[];
}

/** Members with equal data policies, who share one channel (`workspace:<id>.<key>`). */
export interface Audience {
  readonly key: string;
  readonly policy: DataPolicy;
  readonly members: readonly AudienceMember[];
}

/** A view's owner and visibility (#20). */
export interface ViewFact {
  readonly visibility: 'workspace' | 'private';
  readonly ownerMemberId?: string;
}

/** A task's people and linked records (#19). */
export interface TaskFact {
  readonly creatorMemberId?: string;
  readonly assigneeMemberIds: readonly string[];
  readonly records: readonly { readonly objectId: string; readonly recordId: string }[];
}

/** The facts some kinds need, loaded by the relay once per batch. A missing fact counts as not visible. */
export interface EventFacts {
  readonly views?: Readonly<Record<string, ViewFact>>;
  readonly tasks?: Readonly<Record<string, TaskFact>>;
}

/** Which facts a row needs: `views` for views, `tasks` for tasks, none for the rest. */
export function eventFacts(row: EventRow): readonly (keyof EventFacts)[] {
  if (row.kind === 'views') return ['views'];
  if (row.kind === 'tasks') return ['tasks'];
  return [];
}

const without = <T extends { readonly mutationId?: string }>(event: T): T => {
  const { mutationId: _dropped, ...rest } = event;
  return rest as T;
};

/** The event, with `mutationId` left out when anything was removed from it. */
function settle<T extends { readonly mutationId?: string }>(event: T, removed: boolean): T {
  return removed ? without(event) : event;
}

/** Filtering only ever removes, so equal lengths mean nothing was removed. */
const sameList = (a: readonly unknown[], b: readonly unknown[]) => a.length === b.length;

/** True when a fact lookup holds `id` (records made with `Object.create(null)` or plain). */
function factOf<V>(facts: Readonly<Record<string, V>> | undefined, id: string): V | undefined {
  return facts !== undefined && Object.hasOwn(facts, id) ? facts[id] : undefined;
}

/**
 * The records rule, shared by `records` and `entries`: hidden attribute ids
 * and their `replaced` entries removed; when every changed attribute is
 * hidden, the records drop out; under a record rule on `ruleObject`, record
 * (and entry) ids and `replaced` removed and the event made coarse.
 */
function cutRecords<
  T extends {
    readonly recordIds: readonly string[];
    readonly attributeIds: readonly string[];
    readonly coarse?: boolean | undefined;
    readonly replaced?: readonly ReplacedEntry[] | undefined;
    readonly mutationId?: string | undefined;
  },
>(policy: DataPolicy, row: T, owner: string, ruleObject: string, extraIds?: 'entryIds'): T | undefined {
  const attributeIds = row.attributeIds.filter(
    (id) => fieldLevel({ data: policy }, { id, objectId: owner }) !== 'hidden',
  );
  const onlyHidden = row.attributeIds.length > 0 && attributeIds.length === 0;
  const ruled = recordRule({ data: policy }, ruleObject) !== undefined;
  const recordIds = ruled || onlyHidden ? [] : row.recordIds;
  const replaced =
    row.replaced === undefined || ruled
      ? undefined
      : row.replaced.filter((entry) => attributeIds.includes(entry.attributeId) && recordIds.includes(entry.recordId));
  const coarse = row.coarse === true || ruled;
  const extra =
    extraIds === undefined ? {} : { [extraIds]: ruled || onlyHidden ? [] : (row as Record<string, unknown>)[extraIds] };
  const removed =
    !sameList(attributeIds, row.attributeIds) ||
    !sameList(recordIds, row.recordIds) ||
    (row.replaced !== undefined && (replaced === undefined || !sameList(replaced, row.replaced)));
  // Nothing left: no record, no attribute, and not a coarse refetch.
  if (removed && recordIds.length === 0 && attributeIds.length === 0 && !coarse) return undefined;
  if (onlyHidden && row.coarse !== true) return undefined;
  const { replaced: _replaced, ...rest } = row;
  return settle(
    {
      ...rest,
      ...extra,
      recordIds,
      attributeIds,
      coarse,
      ...(replaced === undefined || ruled ? {} : { replaced }),
    } as unknown as T,
    removed,
  );
}

/**
 * The event `audience` may receive of `row`, or undefined when nothing is left
 * for it (the relay then sends spec 0007's stub). `facts` holds what
 * `eventFacts(row)` asked for. With the open policy every member sees every
 * row in full, except a job's id, which only its starter and holders of
 * `jobs.manage` may receive.
 */
export function filterEvent(audience: Audience, row: EventRow, facts: EventFacts = {}): AudienceEvent | undefined {
  const policy = audience.policy;
  const level = (id: string | undefined) => (id === undefined ? 'write' : objectLevel({ data: policy }, id));
  const restricted = policy.key !== OPEN_KEY;
  switch (row.kind) {
    case 'records': {
      if (level(row.objectId) === 'none') return undefined;
      return cutRecords(policy, row, row.objectId, row.objectId);
    }
    case 'entries': {
      if (level(row.listId) === 'none' || level(row.objectId) === 'none') return undefined;
      // A restricted policy can't judge entries whose parent object it doesn't know: coarse, with no ids.
      if (restricted && row.objectId === undefined) {
        return settle(
          { ...row, entryIds: [], recordIds: [], attributeIds: [], coarse: true, replaced: undefined },
          true,
        );
      }
      return cutRecords(policy, row, row.listId, row.objectId ?? row.listId, 'entryIds');
    }
    case 'definitions': {
      // A restricted audience can't judge a row that names neither an object nor a list: nothing (fail closed).
      if (restricted && row.objectId === undefined && row.listId === undefined) return undefined;
      if (level(row.objectId) === 'none' || level(row.listId) === 'none') return undefined;
      if (row.attributeIds === undefined) return row;
      const owner = row.objectId ?? row.listId ?? '';
      const attributeIds = row.attributeIds.filter(
        (id) => fieldLevel({ data: policy }, { id, objectId: owner }) !== 'hidden',
      );
      return settle({ ...row, attributeIds }, !sameList(attributeIds, row.attributeIds));
    }
    case 'views': {
      if (restricted && row.objectId === undefined && row.listId === undefined) return undefined;
      if (level(row.objectId) === 'none' || level(row.listId) === 'none') return undefined;
      const viewIds = row.viewIds.filter((id) => {
        const view = factOf(facts.views, id);
        if (view === undefined) return false;
        if (view.visibility === 'workspace') return true;
        return (
          audience.members.length > 0 && audience.members.every((member) => member.memberId === view.ownerMemberId)
        );
      });
      const removed = !sameList(viewIds, row.viewIds);
      return settle({ ...row, viewIds, coarse: row.coarse || removed }, removed);
    }
    case 'notes': {
      if (level(row.objectId) === 'none') return undefined;
      const ruled = row.objectId === undefined ? restricted : recordRule({ data: policy }, row.objectId) !== undefined;
      if (!ruled) return row;
      return settle({ ...row, recordIds: [], noteIds: [], coarse: true }, true);
    }
    case 'tasks': {
      const visibleRecord = (record: { readonly objectId: string }) =>
        level(record.objectId) !== 'none' && recordRule({ data: policy }, record.objectId) === undefined;
      const taskIds = row.taskIds.filter((id) => {
        const task = factOf(facts.tasks, id);
        if (task === undefined) return false;
        if (task.records.length === 0) return true;
        const involved = audience.members.every(
          (member) => member.memberId === task.creatorMemberId || task.assigneeMemberIds.includes(member.memberId),
        );
        return (audience.members.length > 0 && involved) || task.records.some(visibleRecord);
      });
      // Only linked records the audience may read: those of the kept tasks, on visible objects with no record rule.
      const readable = new Set(
        taskIds.flatMap((id) =>
          (factOf(facts.tasks, id)?.records ?? []).filter(visibleRecord).map((record) => record.recordId),
        ),
      );
      const recordIds = row.recordIds.filter((id) => readable.has(id));
      const removed = !sameList(taskIds, row.taskIds) || !sameList(recordIds, row.recordIds);
      return settle({ ...row, taskIds, recordIds, ...(removed ? { coarse: true } : {}) }, removed);
    }
    case 'members':
    case 'access':
      return row;
    case 'jobs': {
      const { actorMemberId, ...event } = row;
      const readsJob = (member: AudienceMember) =>
        member.memberId === actorMemberId || member.permissions.includes('jobs.manage');
      if (audience.members.length > 0 && audience.members.every(readsJob)) return event;
      return settle({ ...event, jobIds: [], coarse: true }, true);
    }
  }
}
