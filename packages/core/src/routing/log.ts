// Bookings › Routing (spec 0037, AC-1351, AC-1375, AC-1383): what every surface shares, for holders of
// `routing.manage` only (owners and admins), since Decisions shows who each lead was and where they went.
//
// - `routingOverview`: the workspace link always, first, then every form (its live rules, else its draft's) and team
//   page with rules: its rule count, its fallback, and the last 30 days' matched and booked counts (one grouped read
//   over the surfaces' index range). Rules are edited where they live; nothing here edits them.
// - `routingDecisions`: decisions across every surface, newest first, keyset paged on (decided_at, id) through
//   `routing_decisions_by_time`, filtered by surface, rule, host, qualified and day. Names only, never a record fact:
//   a decision whose person record the reader can't see is left out (`visibleRecords`), and a rule over a field hidden
//   from them shows neither its place nor its name (`unseenRules`).
// - `routingDecision`: one of them, by id, or NOT_FOUND.
//
// Reads only: no write, no outbox row.
import { sql, type SQL } from 'drizzle-orm';
import {
  ROUTING_DECISIONS_PAGE,
  RoutingRules,
  RoutingStep,
  type RoutingDecision,
  type RoutingDecisionPage,
  type RoutingDecisionsInput,
  type RoutingFallback,
  type RoutingOverview,
  type RoutingRule,
  type RoutingSurface,
} from '@crm/contracts';
import type { WorkspaceTx } from '@crm/db';
import { requirePermission } from '../access/check.ts';
import type { EngineScope } from '../access/mint.ts';
import { inWorkspace } from '../access/run.ts';
import { visibleRecords } from '../access/visibility.ts';
import { checkId, isUuid, uuidList } from '../engine/ids.ts';
import { postgresError, refuse } from '../engine/refusals.ts';
import { canSeeForm } from '../forms/shared.ts';
import { unseenRules } from './seen.ts';

/** How far back Overview counts, in days. */
const OVERVIEW_DAYS = 30;

/** One routed surface as read: its rules and what it does when none matches. */
interface SurfaceRead {
  readonly kind: 'form' | 'booking_page';
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly isWorkspaceLink: boolean;
  readonly rules: readonly RoutingRule[];
  /** A form's After someone sends it, as read from its document; a page's is its rotation. */
  readonly after: { readonly kind: string; readonly pageId?: string };
}

interface PageRow extends Record<string, unknown> {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly scope: string;
  readonly routing: unknown;
}

interface FormRow extends Record<string, unknown> {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly main_object_id: string | null;
  readonly live_version_id: string | null;
  readonly live_object_id: string | null;
  readonly routing: unknown;
  readonly after_kind: string | null;
  readonly after_page: string | null;
}

const rulesOf = (stored: unknown): readonly RoutingRule[] => RoutingRules.safeParse(stored).data?.rules ?? [];

/** The team pages that route: the workspace link always, and every live or paused round robin page with rules. */
async function routedPages(tx: WorkspaceTx, ids?: readonly string[]): Promise<readonly SurfaceRead[]> {
  const found = await tx.execute<PageRow>(sql`
    select id::text, title, status, scope, routing from booking_pages
    where deleted_at is null and kind = 'round_robin'
      and ${
        ids === undefined
          ? sql`(scope = 'workspace' or jsonb_array_length(coalesce(routing -> 'rules', '[]'::jsonb)) > 0)`
          : sql`id = any(${uuidList(ids)})`
      }
    order by (scope = 'workspace') desc, lower(title), id
  `);
  return found.rows.map((row) => ({
    kind: 'booking_page',
    id: row.id,
    name: row.title,
    status: row.status,
    isWorkspaceLink: row.scope === 'workspace',
    rules: rulesOf(row.routing),
    after: { kind: 'rotation' },
  }));
}

/** The forms that route (their live rules, else a never published form's draft ones), as the reader may see them. */
async function routedForms(
  tx: WorkspaceTx,
  scope: EngineScope,
  ids?: readonly string[],
): Promise<readonly SurfaceRead[]> {
  const found = await tx.execute<FormRow>(sql`
    select f.id::text, f.name, f.status, f.main_object_id::text, f.live_version_id::text,
      lv.document -> 'targets' -> 'main' ->> 'objectId' as live_object_id,
      v.document -> 'routing' as routing,
      v.document -> 'after' ->> 'kind' as after_kind,
      v.document -> 'after' ->> 'bookingPageId' as after_page
    from forms f
    join form_versions v on v.workspace_id = f.workspace_id and v.id = coalesce(f.live_version_id, f.draft_version_id)
    left join form_versions lv on lv.workspace_id = f.workspace_id and lv.id = f.live_version_id
    where ${
      ids === undefined
        ? sql`f.status <> 'archived' and jsonb_array_length(coalesce(v.document -> 'routing' -> 'rules', '[]'::jsonb)) > 0`
        : sql`f.id = any(${uuidList(ids)})`
    }
    order by lower(f.name), f.id
  `);
  return found.rows
    .filter((row) =>
      canSeeForm(scope.access, {
        mainObjectId: row.main_object_id,
        liveVersionId: row.live_version_id,
        liveObjectId: row.live_object_id,
      }),
    )
    .map((row) => ({
      kind: 'form',
      id: row.id,
      name: row.name,
      status: row.status,
      isWorkspaceLink: false,
      rules: rulesOf(row.routing),
      after: {
        kind: row.after_kind ?? 'message',
        ...(row.after_page !== null && isUuid(row.after_page) ? { pageId: row.after_page } : {}),
      },
    }));
}

/** Booking pages' titles by id (any page, deleted ones too: a decision may name one since deleted). */
async function pageNames(tx: WorkspaceTx, ids: readonly string[]): Promise<ReadonlyMap<string, string>> {
  const wanted = [...new Set(ids)].filter(isUuid);
  if (wanted.length === 0) return new Map();
  const found = await tx.execute<{ id: string; title: string }>(
    sql`select id::text, title from booking_pages where id = any(${uuidList(wanted)})`,
  );
  return new Map(found.rows.map((row) => [row.id, row.title]));
}

/** Members' names by id. */
async function memberNames(tx: WorkspaceTx, ids: readonly string[]): Promise<ReadonlyMap<string, string>> {
  const wanted = [...new Set(ids)].filter(isUuid);
  if (wanted.length === 0) return new Map();
  const found = await tx.execute<{ id: string; name: string }>(
    sql`select id::text, name from members where id = any(${uuidList(wanted)})`,
  );
  return new Map(found.rows.map((row) => [row.id, row.name]));
}

/** A surface's fallback as Overview names it. */
function fallbackOf(surface: SurfaceRead, names: ReadonlyMap<string, string>): RoutingFallback {
  if (surface.kind === 'booking_page') return { kind: 'rotation' };
  const { after } = surface;
  if (after.kind === 'booking' && after.pageId !== undefined) {
    return { kind: 'page', pageId: after.pageId, name: names.get(after.pageId) ?? '' };
  }
  return after.kind === 'redirect' ? { kind: 'redirect' } : { kind: 'message' };
}

/** Routing › Overview (AC-1383): the workspace link first, then every form and team page with rules. */
export async function routingOverview(scope: EngineScope, now: Date = new Date()): Promise<RoutingOverview> {
  requirePermission(scope, 'routing.manage');
  return inWorkspace(scope, async (tx) => {
    const pages = await routedPages(tx);
    const forms = await routedForms(tx, scope);
    const surfaces = [
      ...pages.filter((page) => page.isWorkspaceLink),
      ...forms,
      ...pages.filter((page) => !page.isWorkspaceLink),
    ];
    if (surfaces.length === 0) return { surfaces: [] };
    const since = new Date(now.getTime() - OVERVIEW_DAYS * 86_400_000).toISOString();
    const counted = await tx.execute<{ surface_id: string; matched: number; booked: number }>(sql`
      select surface_id::text, (count(*) filter (where rule_id is not null))::int as matched,
        count(booking_id)::int as booked
      from routing_decisions
      where surface_id = any(${uuidList(surfaces.map((surface) => surface.id))}) and decided_at >= ${since}::timestamptz
      group by surface_id
    `);
    const counts = new Map(counted.rows.map((row) => [row.surface_id, row]));
    const names = await pageNames(
      tx,
      surfaces.flatMap((surface) => (surface.after.pageId === undefined ? [] : [surface.after.pageId])),
    );
    const unseen = await unseenRules(
      tx,
      scope.access,
      pages.flatMap((page) => page.rules),
    );
    return {
      surfaces: surfaces.map((surface): RoutingSurface => ({
        kind: surface.kind,
        id: surface.id,
        name: surface.name,
        isWorkspaceLink: surface.isWorkspaceLink,
        status: surface.status,
        rules: surface.rules.length,
        ruleList: surface.rules.map((rule) =>
          rule.name === undefined || rule.name === '' || (surface.kind === 'booking_page' && unseen(rule))
            ? { id: rule.id }
            : { id: rule.id, name: rule.name },
        ),
        fallback: fallbackOf(surface, names),
        matched: counts.get(surface.id)?.matched ?? 0,
        booked: counts.get(surface.id)?.booked ?? 0,
      })),
    };
  });
}

/** One decision as read, before names. */
interface DecisionRow extends Record<string, unknown> {
  readonly id: string;
  readonly at: string;
  readonly decided_at: string;
  readonly surface_kind: 'form' | 'booking_page';
  readonly surface_id: string;
  readonly rule_id: string | null;
  readonly qualified: boolean | null;
  readonly skipped: readonly string[] | null;
  readonly routed_page_id: string | null;
  readonly hosts: readonly string[] | null;
  readonly steps: unknown;
  readonly booking_id: string | null;
  readonly booking_host: string | null;
  readonly starts_at: string | null;
  readonly booking_status: string | null;
  readonly no_show: boolean | null;
  readonly visitor_name: string | null;
  readonly lead_name: string | null;
  readonly person_id: string | null;
  readonly person_object_id: string | null;
}

/** A cursor: the last row's time (Postgres's own text, to the microsecond) and id. */
function encodeCursor(row: Pick<DecisionRow, 'at' | 'id'>): string {
  return Buffer.from(`${row.at}|${row.id}`, 'utf8').toString('base64url');
}

/** Postgres's own text for a timestamptz, the only time a cursor may carry (anything else would fail its cast). */
const CURSOR_AT = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?[+-]\d{2}(:\d{2})?$/;

/** How long one page of decisions may take: a filter no index serves (a host) never runs on unbounded. */
const DECISIONS_STATEMENT_TIMEOUT = '3s';

function decodeCursor(cursor: string): { readonly at: string; readonly id: string } {
  const [at, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  if (at === undefined || id === undefined || !isUuid(id) || !CURSOR_AT.test(at)) {
    throw refuse('CONFIG_INVALID', 'That page of decisions is out of date. Start again from the top.');
  }
  return { at, id };
}

/** The decisions matching `where`, newest first, with their booking, lead and person, at most `limit`. */
async function readDecisions(tx: WorkspaceTx, where: SQL, limit: number) {
  const found = await tx.execute<DecisionRow>(sql`
    select d.id::text, d.decided_at::text as at, to_json(d.decided_at)#>>'{}' as decided_at,
      d.surface_kind, d.surface_id::text, d.rule_id, d.qualified, d.skipped, d.routed_page_id::text,
      d.hosts::text[] as hosts, d.steps,
      b.id::text as booking_id, b.host_member_id::text as booking_host, to_json(b.starts_at)#>>'{}' as starts_at,
      b.status as booking_status, (b.no_show_at is not null) as no_show, b.visitor_name,
      case when jsonb_typeof(s.answers -> 'name') = 'string' then left(s.answers ->> 'name', 200) end as lead_name,
      r.id::text as person_id, r.object_id::text as person_object_id
    from routing_decisions d
    left join bookings b on b.workspace_id = d.workspace_id and b.id = d.booking_id
    left join form_submissions s on s.workspace_id = d.workspace_id and s.id = d.submission_id
    left join records r on r.workspace_id = d.workspace_id and r.id = coalesce(b.person_record_id, s.main_record_id)
    where ${where}
    order by d.decided_at desc, d.id desc
    limit ${limit}
  `);
  return found.rows;
}

/** The decisions' rows as the log shows them, those whose person the reader can't see left out (AC-1375). */
async function decisionsOf(
  tx: WorkspaceTx,
  scope: EngineScope,
  rows: readonly DecisionRow[],
): Promise<readonly RoutingDecision[]> {
  const people = rows.flatMap((row) =>
    row.person_id === null || row.person_object_id === null
      ? []
      : [{ objectId: row.person_object_id, recordId: row.person_id }],
  );
  const seen = people.length === 0 ? new Set<string>() : await visibleRecords(tx, scope.access, people);
  const kept = rows.filter((row) => row.person_id === null || seen.has(row.person_id));
  if (kept.length === 0) return [];
  const pageIds = kept.filter((row) => row.surface_kind === 'booking_page').map((row) => row.surface_id);
  const formIds = kept.filter((row) => row.surface_kind === 'form').map((row) => row.surface_id);
  const surfaces = [
    ...(pageIds.length === 0 ? [] : await routedPages(tx, [...new Set(pageIds)])),
    ...(formIds.length === 0 ? [] : await routedForms(tx, scope, [...new Set(formIds)])),
  ];
  const byId = new Map(surfaces.map((surface) => [surface.id, surface]));
  const unseen = await unseenRules(
    tx,
    scope.access,
    surfaces.filter((surface) => surface.kind === 'booking_page').flatMap((surface) => surface.rules),
  );
  const steps = new Map(kept.map((row) => [row.id, parseSteps(row.steps)]));
  const pages = await pageNames(tx, [
    ...kept.flatMap((row) => (row.routed_page_id === null ? [] : [row.routed_page_id])),
    ...[...steps.values()].flatMap((list) => list.flatMap((step) => (step.pageId === undefined ? [] : [step.pageId]))),
  ]);
  const members = await memberNames(tx, [
    ...kept.flatMap((row) => row.hosts ?? []),
    ...kept.flatMap((row) => (row.booking_host === null ? [] : [row.booking_host])),
  ]);
  return kept.flatMap((row): RoutingDecision[] => {
    const surface = byId.get(row.surface_id);
    // A form the reader can't see keeps its decisions out of their log.
    if (surface === undefined && row.surface_kind === 'form') return [];
    const rules = surface?.rules ?? [];
    const position = row.rule_id === null ? -1 : rules.findIndex((rule) => rule.id === row.rule_id);
    const ruleNow = position === -1 ? undefined : rules[position];
    const label = (id: string) => {
      const at = rules.findIndex((rule) => rule.id === id);
      const found = rules[at];
      return found === undefined || (surface?.kind === 'booking_page' && unseen(found))
        ? 'A rule'
        : `Rule ${String(at + 1)}`;
    };
    return [
      {
        id: row.id,
        decidedAt: row.decided_at,
        surface: { kind: row.surface_kind, id: row.surface_id, name: surface?.name ?? '' },
        ...(row.rule_id === null
          ? {}
          : {
              rule:
                ruleNow !== undefined && surface?.kind === 'booking_page' && unseen(ruleNow)
                  ? { id: row.rule_id, hidden: true as const }
                  : {
                      id: row.rule_id,
                      ...(ruleNow === undefined ? {} : { position: position + 1 }),
                      ...(ruleNow?.name === undefined || ruleNow.name === '' ? {} : { name: ruleNow.name }),
                    },
            }),
        ...(row.qualified === null ? {} : { qualified: row.qualified }),
        ...(row.routed_page_id === null
          ? {}
          : { routedPage: { id: row.routed_page_id, name: pages.get(row.routed_page_id) ?? '' } }),
        hosts: (row.hosts ?? []).map((id) => ({ id, name: members.get(id) ?? '' })),
        ...(row.booking_id === null || row.booking_host === null || row.starts_at === null
          ? {}
          : {
              booking: {
                id: row.booking_id,
                hostName: members.get(row.booking_host) ?? '',
                startsAt: row.starts_at,
                status: row.booking_status ?? 'confirmed',
                noShow: row.no_show === true,
              },
            }),
        ...((row.visitor_name ?? row.lead_name) === null ? {} : { guest: row.visitor_name ?? row.lead_name ?? '' }),
        steps: (steps.get(row.id) ?? []).map((step) => ({
          ...step,
          ...(step.pageId === undefined ? {} : { pageName: pages.get(step.pageId) ?? '' }),
        })),
        skipped: [...new Set(row.skipped ?? [])].map(label),
      },
    ];
  });
}

function parseSteps(stored: unknown): readonly RoutingStep[] {
  if (!Array.isArray(stored)) return [];
  return stored.flatMap((each) => {
    const parsed = RoutingStep.safeParse(each);
    return parsed.success ? [parsed.data] : [];
  });
}

/** Routing › Decisions (AC-1383): a page of decisions across every surface, newest first, with the filters. */
export async function routingDecisions(
  scope: EngineScope,
  input: Omit<RoutingDecisionsInput, 'workspace'>,
): Promise<RoutingDecisionPage> {
  requirePermission(scope, 'routing.manage');
  const after = input.cursor === undefined ? undefined : decodeCursor(input.cursor);
  const conditions = [
    sql`true`,
    ...(input.surfaceId === undefined
      ? []
      : [sql`d.surface_id = ${checkId(input.surfaceId, 'Pick a form or page.')}::uuid`]),
    ...(input.ruleId === undefined
      ? []
      : [input.ruleId === 'fallback' ? sql`d.rule_id is null` : sql`d.rule_id = ${input.ruleId}`]),
    ...(input.hostId === undefined
      ? []
      : [
          sql`(b.host_member_id = ${checkId(input.hostId, 'Pick a person.')}::uuid or d.hosts @> array[${input.hostId}::uuid])`,
        ]),
    ...(input.qualified === undefined
      ? []
      : [input.qualified === 'none' ? sql`d.qualified is null` : sql`d.qualified = ${input.qualified === 'yes'}`]),
    ...(input.from === undefined ? [] : [sql`d.decided_at >= ${input.from}::date`]),
    ...(input.to === undefined ? [] : [sql`d.decided_at < ${input.to}::date + 1`]),
    ...(after === undefined ? [] : [sql`(d.decided_at, d.id) < (${after.at}::timestamptz, ${after.id}::uuid)`]),
  ];
  return inWorkspace(scope, async (tx) => {
    await tx.execute(sql`select set_config('statement_timeout', ${DECISIONS_STATEMENT_TIMEOUT}, true)`);
    let rows: readonly DecisionRow[];
    try {
      rows = await readDecisions(tx, sql.join(conditions, sql` and `), ROUTING_DECISIONS_PAGE + 1);
    } catch (error) {
      if (postgresError(error)?.code === '57014') {
        throw refuse('QUERY_CANCELLED', 'That took too long. Narrow the filters and try again.');
      }
      throw error;
    }
    const page = rows.slice(0, ROUTING_DECISIONS_PAGE);
    const last = page.at(-1);
    const decisions = await decisionsOf(tx, scope, page);
    return {
      decisions: [...decisions],
      ...(rows.length > ROUTING_DECISIONS_PAGE && last !== undefined ? { next: encodeCursor(last) } : {}),
    };
  });
}

/** One decision (AC-1383), or NOT_FOUND, also for one whose person the reader can't see. */
export async function routingDecision(scope: EngineScope, input: { readonly id: string }): Promise<RoutingDecision> {
  requirePermission(scope, 'routing.manage');
  const missing = 'That decision doesn’t exist.';
  return inWorkspace(scope, async (tx) => {
    const rows = await readDecisions(tx, sql`d.id = ${checkId(input.id, missing)}::uuid`, 1);
    const [decision] = await decisionsOf(tx, scope, rows);
    if (decision === undefined) throw refuse('NOT_FOUND', missing);
    return decision;
  });
}
