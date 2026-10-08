// Catch up (spec 0007, milestone 1): what a browser missed since its watermark,
// read from the outbox when Centrifugo's memory history no longer has it.
// Every row passes the caller's own audience through spec 0009's
// `filterEvent`, the same rule live delivery uses, so a catch up never names
// an id the caller wouldn't have received live; a row that leaves nothing is
// skipped (a catch up carries no stubs). What is left collapses into at most
// one event per kind and object or list, ids merged.
//
// The head is read first, in the same transaction: a row's `seq` and the
// counter commit together, so every row up to the head is there to read. Rows
// are read a page at a time along the primary key, and the first missing
// `seq` (pruned, or never retained) answers `reset`, as does a watermark more
// than `CATCH_UP_MAX_ROWS` behind, or ahead of the head (a watermark from
// another history).
import type { CatchUp } from '@crm/contracts';
import { OUTBOX_ROW_COLUMNS, outboxRowOf, schema, type RawOutboxRow, type WorkspaceTx } from '@crm/db';
import { eq, sql } from 'drizzle-orm';
import { filterEvent, type Audience, type AudienceEvent } from '../access/events.ts';
import type { EngineScope } from '../access/mint.ts';
import type { Access } from '../access/policy.ts';
import { inWorkspace } from '../access/run.ts';
import { CHANGE_CAP } from '../engine/write.ts';
import { outboxEvent, wireEvent } from './events.ts';

/** The most changes a catch up reads; a watermark further behind answers `reset` (spec 0007). */
export const CATCH_UP_MAX_ROWS = 5_000;

/**
 * How many outbox rows one read of a catch up takes, so its memory stays flat
 * whatever the range: a row names at most 1,000 records (`CHANGE_CAP`), so a
 * page holds at most about 200,000 ids.
 */
const PAGE = 200;

/** How long one statement of a catch up may run before Postgres cancels it, in ms. */
const STATEMENT_TIMEOUT_MS = 5_000;

const { workspaceCounters } = schema;

type Kind = AudienceEvent['kind'];
type IdField = 'recordIds' | 'attributeIds' | 'entryIds' | 'viewIds' | 'noteIds' | 'taskIds' | 'memberIds' | 'jobIds';

/** The id lists each kind merges. */
const MERGED: Readonly<Record<Kind, readonly IdField[]>> = {
  records: ['recordIds', 'attributeIds'],
  entries: ['entryIds', 'recordIds', 'attributeIds'],
  definitions: ['attributeIds'],
  views: ['viewIds'],
  notes: ['recordIds', 'noteIds'],
  tasks: ['recordIds', 'taskIds'],
  members: ['memberIds'],
  access: ['memberIds'],
  jobs: ['jobIds'],
};

/** The id lists a coarse event empties (past `CHANGE_CAP`, or a coarse row merged in); kinds with none never go coarse. */
const CAPPED: Readonly<Record<Kind, readonly IdField[]>> = {
  records: ['recordIds'],
  entries: ['entryIds', 'recordIds'],
  definitions: [],
  views: ['viewIds'],
  notes: ['recordIds', 'noteIds'],
  tasks: ['recordIds', 'taskIds'],
  members: [],
  access: [],
  jobs: ['jobIds'],
};

interface Group {
  readonly kind: Kind;
  seq: number;
  at: string;
  readonly objectId: string | undefined;
  readonly listId: string | undefined;
  readonly ids: Map<IdField, Set<string>>;
  coarse: boolean;
  /** A `definitions` row that named no attributes: the whole set is refetched. */
  whole: boolean;
}

/** One event's string field, read without knowing its kind. */
const field = (event: AudienceEvent, name: string): unknown => (event as Readonly<Record<string, unknown>>)[name];
const text = (event: AudienceEvent, name: string): string | undefined => {
  const value = field(event, name);
  return typeof value === 'string' ? value : undefined;
};

/**
 * Collapses filtered events, in `seq` order, into at most one per kind and
 * object or list: ids merged in the order first seen, past `CHANGE_CAP` (or
 * when any merged event was coarse) the capped lists emptied and the event
 * coarse. Each carries the `seq` and `at` of the last event it covers, and no
 * `mutationId` or `replaced`. Pure; feed it with `add`, read it with `events`.
 */
export function createCollapse() {
  const groups = new Map<string, Group>();
  const makeCoarse = (group: Group) => {
    group.coarse = true;
    for (const name of CAPPED[group.kind]) group.ids.set(name, new Set());
  };
  return {
    add(event: AudienceEvent): void {
      const objectId = text(event, 'objectId');
      const listId = text(event, 'listId');
      const key = `${event.kind}\u0000${objectId ?? ''}\u0000${listId ?? ''}`;
      const group = groups.get(key) ?? {
        kind: event.kind,
        seq: event.seq,
        at: event.at,
        objectId,
        listId,
        ids: new Map(MERGED[event.kind].map((name) => [name, new Set<string>()])),
        coarse: false,
        whole: false,
      };
      groups.set(key, group);
      group.seq = event.seq;
      group.at = event.at;
      if (event.kind === 'definitions' && event.attributeIds === undefined) group.whole = true;
      if (field(event, 'coarse') === true && CAPPED[event.kind].length > 0 && !group.coarse) makeCoarse(group);
      for (const name of MERGED[event.kind]) {
        const capped = CAPPED[event.kind].includes(name);
        if (capped && group.coarse) continue;
        const ids = group.ids.get(name);
        const incoming = field(event, name);
        if (ids === undefined || !Array.isArray(incoming)) continue;
        for (const id of incoming) if (typeof id === 'string') ids.add(id);
        if (capped && ids.size > CHANGE_CAP) makeCoarse(group);
      }
    },
    /** The collapsed events, by the `seq` of the last change each covers. */
    events(): AudienceEvent[] {
      return [...groups.values()]
        .sort((a, b) => a.seq - b.seq)
        .map((group) => {
          const lists = Object.fromEntries([...group.ids].map(([name, ids]) => [name, [...ids]]));
          if (group.kind === 'definitions' && group.whole) delete lists.attributeIds;
          return {
            seq: group.seq,
            at: group.at,
            kind: group.kind,
            ...(group.objectId === undefined ? {} : { objectId: group.objectId }),
            ...(group.listId === undefined ? {} : { listId: group.listId }),
            ...lists,
            ...(group.coarse ? { coarse: true } : {}),
          } as AudienceEvent;
        });
    },
  };
}

/**
 * The caller as an audience of one: their data policy, and for a member
 * their id and permissions (which spec 0009's `jobs` rule reads).
 */
export function audienceOf(access: Access): Audience {
  const { principal } = access;
  return {
    key: access.data.key,
    policy: access.data,
    members:
      principal.kind === 'member'
        ? [
            {
              memberId: principal.memberId,
              ...(principal.userId === undefined ? {} : { userId: principal.userId }),
              permissions: access.permissions,
            },
          ]
        : [],
  };
}

/** The workspace's last `seq` (0 before its first event), read without a lock. */
async function headIn(tx: WorkspaceTx, workspaceId: string): Promise<number> {
  const [row] = await tx
    .select({ head: workspaceCounters.outboxSeq })
    .from(workspaceCounters)
    // Row level security keeps the read to this workspace; the filter says so too (house style).
    .where(eq(workspaceCounters.workspaceId, workspaceId));
  return row?.head ?? 0;
}

/** The workspace's head, the watermark a browser starts from (`realtime.subscriptionToken`). */
export function workspaceHead(scope: EngineScope): Promise<number> {
  return inWorkspace(scope, (tx) => headIn(tx, scope.workspaceId));
}

/**
 * What the caller missed since `after` (the last `seq` they applied), up to
 * the head, filtered through their own audience and collapsed. `reset: true`
 * with no events when the outbox no longer holds every change since `after` (0, the start, by default),
 * when `after` is more than `CATCH_UP_MAX_ROWS` behind, or ahead of the head.
 */
export async function catchUp(scope: EngineScope, input: { readonly after: number } = { after: 0 }): Promise<CatchUp> {
  const audience = audienceOf(scope.access);
  return inWorkspace(scope, async (tx) => {
    // A catch up never holds a pooled connection long, whatever the range.
    await tx.execute(sql`select set_config('statement_timeout', ${String(STATEMENT_TIMEOUT_MS)}, true)`);
    const head = await headIn(tx, scope.workspaceId);
    const { after } = input;
    const reset: CatchUp = { head, reset: true, events: [] };
    if (after === head) return { head, reset: false, events: [] };
    if (after > head || head - after > CATCH_UP_MAX_ROWS) return reset;
    const collapse = createCollapse();
    let last = after;
    while (last < head) {
      const page = await tx.execute<RawOutboxRow & Record<string, unknown>>(sql`
        select ${sql.raw(OUTBOX_ROW_COLUMNS)} from outbox
        where workspace_id = ${scope.workspaceId} and seq > ${last} and seq <= ${head}
        order by seq limit ${PAGE}
      `);
      // Nothing more up to the head, or a hole: those changes are gone (pruned), so the screen resyncs.
      if (page.rows.length === 0) return reset;
      for (const raw of page.rows) {
        const row = outboxRowOf(raw);
        if (row.seq !== last + 1) return reset;
        last = row.seq;
        const event = outboxEvent(row);
        const kept = event === undefined ? undefined : filterEvent(audience, event);
        if (kept !== undefined) collapse.add(kept);
      }
    }
    return { head, reset: false, events: collapse.events().map(wireEvent) };
  });
}
