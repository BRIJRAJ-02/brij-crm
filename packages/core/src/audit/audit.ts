// Settings › History › Workspace changes (spec 0046): a page of the workspace's
// audit rows, newest first, behind `audit.read`. The permission is checked
// before anything is read. One transaction, under a 3 second statement timeout:
// the page in `audit_events_at`'s own order (`at desc nulls last, id asc`: without
// `nulls last` the index can't give the order and every page sorts the whole
// log; `at` is never null, so the rows are the same), keyset paged on
// (`at`, `id`) with `at` kept as Postgres's text to the microsecond (rows one
// transaction wrote share `at`), then one statement naming every member,
// invitation, request, round robin, form, booking page and booking the page
// mentions (skipped when the page names nothing). `ip` and `request_id` are
// never selected, and nothing is written.
import { AUDIT_KINDS, AUDIT_PAGE, AUDIT_PAGE_MAX, type AuditListInput, type AuditPage } from '@crm/contracts';
import type { WorkspaceTx } from '@crm/db';
import { sql, type SQL } from 'drizzle-orm';
import { requirePermission } from '../access/check.ts';
import { inWorkspace } from '../access/run.ts';
import { isUuid, uuidList } from '../engine/ids.ts';
import { inputInvalid } from '../engine/refusals.ts';
import type { EngineScope } from '../engine/scope.ts';
import {
  auditNameIds,
  toEntryView,
  type AuditMemberName,
  type AuditNameIds,
  type AuditNames,
  type AuditRow,
  type AuditThingName,
} from './view.ts';

/** How long one statement of a page may run. */
export const AUDIT_STATEMENT_TIMEOUT = '3s';

/** What a cursor that isn't one of ours answers (400 INPUT_INVALID). */
export const AUDIT_CURSOR_MESSAGE = 'That list position is not valid here. Start again from the top.';

/** The actions Workspace changes lists, as the page statement filters them. */
const LISTED = `{${Object.values(AUDIT_KINDS).flat().join(',')}}`;

/** Postgres's `at`, UTC, to the microsecond: the cursor's text and the entry's time. */
const AT_TEXT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

/** A position in the log: the last row's `at`, as the database's text, and its id. */
export interface Position {
  readonly at: string;
  readonly id: string;
}

function encodeCursor(position: Position): string {
  return Buffer.from(JSON.stringify({ a: position.at, i: position.id })).toString('base64url');
}

/** A cursor back to its position; anything else (one with its microseconds cut included) is INPUT_INVALID. */
function decodeCursor(cursor: string): Position {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      const { a, i, ...rest } = parsed as Record<string, unknown>;
      if (Object.keys(rest).length === 0 && typeof a === 'string' && AT_TEXT.test(a) && isUuid(i)) {
        return { at: a, id: i.toLowerCase() };
      }
    }
  } catch {
    // Falls through to the refusal.
  }
  throw inputInvalid('cursor', AUDIT_CURSOR_MESSAGE);
}

interface PageRow extends Record<string, unknown> {
  readonly id: string;
  readonly at: string;
  readonly actor_type: string;
  readonly actor_member_id: string | null;
  readonly action: string;
  readonly target_type: string;
  readonly target_id: string | null;
  readonly before: unknown;
  readonly after: unknown;
}

/**
 * The page statement: one page of rows in `audit_events_at`'s order, walked from the index with no sort (the EXPLAIN
 * test in `audit.test.ts` holds it to that). Never `ip`, never `request_id`, never an unlisted action. Exported for
 * that test alone.
 */
export function auditPageStatement(workspaceId: string, after: Position | undefined, limit: number): SQL {
  const from =
    after === undefined
      ? sql``
      : sql`and a.at <= ${after.at}::timestamptz and (a.at < ${after.at}::timestamptz or a.id > ${after.id}::uuid)`;
  return sql`
    select a.id::text as id,
      to_char(a.at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as at,
      a.actor_type::text as actor_type, a.actor_member_id::text as actor_member_id,
      a.action, a.target_type, a.target_id, a.before, a.after
    from audit_events a
    where a.workspace_id = ${workspaceId}::uuid and a.action = any(${LISTED}::text[]) ${from}
    order by a.at desc nulls last, a.id asc
    limit ${limit + 1}
  `;
}

/** One page of rows, and one more to tell whether another page follows. */
async function readPage(
  tx: WorkspaceTx,
  workspaceId: string,
  after: Position | undefined,
  limit: number,
): Promise<readonly AuditRow[]> {
  const found = await tx.execute<PageRow>(auditPageStatement(workspaceId, after, limit));
  return found.rows.map((row) => ({
    id: row.id,
    at: row.at,
    actorType: row.actor_type,
    actorMemberId: row.actor_member_id,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    before: row.before,
    after: row.after,
  }));
}

interface NameRow extends Record<string, unknown> {
  readonly kind: string;
  readonly id: string;
  readonly name: string | null;
  readonly state: string | null;
  readonly extra: string | null;
}

/**
 * Every name a page mentions, in one statement: a `union all` with one branch per kind that has ids, each filtered
 * on the workspace as well as by row level security. A member is `deleted` once their account went (no user, and
 * the address account deletion leaves), `former` once removed. Never a member's or an asker's address, and never an
 * invitation's once the member it made deleted their account.
 */
async function readNames(tx: WorkspaceTx, workspaceId: string, ids: AuditNameIds): Promise<AuditNames | undefined> {
  const ws = sql`${workspaceId}::uuid`;
  const branches: SQL[] = [];
  if (ids.members.length > 0) {
    branches.push(sql`
      select 'member' as kind, m.id::text as id, m.name as name,
        case
          when m.user_id is null and m.email = 'deleted-' || m.id::text || '@deleted.invalid' then 'deleted'
          when m.status = 'removed' then 'former'
          else 'active'
        end as state, null::text as extra
      from members m where m.workspace_id = ${ws} and m.id = any(${uuidList(ids.members)})`);
  }
  if (ids.invitations.length > 0) {
    // A used invitation keeps its address, but once the member it made deleted their account the address is theirs
    // to take with them: it reads as no address, as account deletion leaves their member row (AC-4610).
    branches.push(sql`
      select 'invitation', i.id::text,
        case when exists (
          select 1 from members m
          where m.workspace_id = i.workspace_id and m.id = i.used_by_member_id
            and m.user_id is null and m.email = 'deleted-' || m.id::text || '@deleted.invalid'
        ) then null else i.email end,
        i.kind, null::text
      from invitations i where i.workspace_id = ${ws} and i.id = any(${uuidList(ids.invitations)})`);
  }
  if (ids.joinRequests.length > 0) {
    branches.push(sql`
      select 'join_request', j.id::text, j.name, null::text, null::text
      from join_requests j where j.workspace_id = ${ws} and j.id = any(${uuidList(ids.joinRequests)})`);
  }
  if (ids.rotations.length > 0) {
    branches.push(sql`
      select 'rotation', r.id::text, r.name, case when r.deleted_at is null then 'live' else 'gone' end, null::text
      from rotations r where r.workspace_id = ${ws} and r.id = any(${uuidList(ids.rotations)})`);
  }
  if (ids.forms.length > 0) {
    branches.push(sql`
      select 'form', f.id::text, f.name, 'live', null::text
      from forms f where f.workspace_id = ${ws} and f.id = any(${uuidList(ids.forms)})`);
  }
  if (ids.bookingPages.length > 0) {
    branches.push(sql`
      select 'booking_page', p.id::text, p.title, case when p.deleted_at is null then 'live' else 'gone' end, null::text
      from booking_pages p where p.workspace_id = ${ws} and p.id = any(${uuidList(ids.bookingPages)})`);
  }
  if (ids.lists.length > 0) {
    // An archived list is still the list: its name, never gone (lists are archived, not deleted).
    branches.push(sql`
      select 'list', l.id::text, l.name, 'live', null::text
      from lists l where l.workspace_id = ${ws} and l.id = any(${uuidList(ids.lists)})`);
  }
  if (ids.bookings.length > 0) {
    branches.push(sql`
      select 'booking', b.id::text, p.title, 'live',
        to_char(b.starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
      from bookings b join booking_pages p on p.workspace_id = b.workspace_id and p.id = b.page_id
      where b.workspace_id = ${ws} and b.id = any(${uuidList(ids.bookings)})`);
  }
  if (branches.length === 0) return undefined;
  const found = await tx.execute<NameRow>(sql.join(branches, sql` union all `));
  const members = new Map<string, AuditMemberName>();
  const invitations = new Map<string, { readonly email?: string; readonly isLink: boolean }>();
  const joinRequests = new Map<string, string>();
  const rotations = new Map<string, AuditThingName>();
  const forms = new Map<string, AuditThingName>();
  const bookingPages = new Map<string, AuditThingName>();
  const bookings = new Map<string, { readonly pageTitle: string; readonly startsAt: string }>();
  const lists = new Map<string, AuditThingName>();
  for (const row of found.rows) {
    const name = row.name ?? '';
    const thing = { name, isGone: row.state === 'gone' };
    switch (row.kind) {
      case 'member':
        members.set(row.id, {
          name,
          state: row.state === 'deleted' ? 'deleted' : row.state === 'former' ? 'former' : 'active',
        });
        break;
      case 'invitation':
        invitations.set(row.id, { ...(row.name === null ? {} : { email: row.name }), isLink: row.state === 'link' });
        break;
      case 'join_request':
        joinRequests.set(row.id, name);
        break;
      case 'rotation':
        rotations.set(row.id, thing);
        break;
      case 'form':
        forms.set(row.id, thing);
        break;
      case 'booking_page':
        bookingPages.set(row.id, thing);
        break;
      case 'booking':
        if (row.extra !== null) bookings.set(row.id, { pageTitle: name, startsAt: row.extra });
        break;
      case 'list':
        lists.set(row.id, thing);
        break;
      default:
        break;
    }
  }
  return { members, invitations, joinRequests, rotations, forms, bookingPages, bookings, lists };
}

const NO_NAMES: AuditNames = {
  members: new Map(),
  invitations: new Map(),
  joinRequests: new Map(),
  rotations: new Map(),
  forms: new Map(),
  bookingPages: new Map(),
  bookings: new Map(),
  lists: new Map(),
};

/**
 * A page of the workspace's audit log, newest first (spec 0046, AC-4603, AC-4621 to AC-4628): `audit.read` only,
 * 403 FORBIDDEN with the catalog's sentence before any read. A cursor is a position, never a key: one minted in
 * another workspace pages through the caller's own rows only. `member.preferences_changed` and any action the
 * screen doesn't list are left out. Reads only.
 */
export async function listAuditEvents(
  scope: EngineScope,
  input: Pick<AuditListInput, 'cursor' | 'limit'> = {},
): Promise<AuditPage> {
  requirePermission(scope, 'audit.read');
  const after = input.cursor === undefined ? undefined : decodeCursor(input.cursor);
  // The contract holds it to 1 to 100; a caller inside the server is held to the same.
  const asked = input.limit ?? AUDIT_PAGE;
  const limit = Number.isFinite(asked) ? Math.min(Math.max(Math.trunc(asked), 1), AUDIT_PAGE_MAX) : AUDIT_PAGE;
  return inWorkspace(scope, async (tx) => {
    // Every statement of the page is held to the timeout, so a slow read never holds a pooled connection long.
    await tx.execute(sql`select set_config('statement_timeout', ${AUDIT_STATEMENT_TIMEOUT}, true)`);
    const rows = await readPage(tx, scope.workspaceId, after, limit);
    const page = rows.slice(0, limit);
    const names = page.length === 0 ? undefined : await readNames(tx, scope.workspaceId, auditNameIds(page));
    const last = page.at(-1);
    return {
      entries: page.flatMap((row) => {
        const entry = toEntryView(row, names ?? NO_NAMES);
        return entry === undefined ? [] : [entry];
      }),
      ...(rows.length > limit && last !== undefined ? { nextCursor: encodeCursor({ at: last.at, id: last.id }) } : {}),
    };
  });
}
