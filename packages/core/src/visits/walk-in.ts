// Walk ins on the Service screen (spec 0066 B7 lite; AC-6671 "walk in from any free tile"): a party that walks in is
// seated now. `freeTables` answers which tables (alone, or joined as the planner joins them) are free from now for the
// party's whole hold, best fit first; `seatWalkIn` seats the party at the tables the host picked, under the place lock
// (the same lock every visit write takes first), checking again that they are still free and still seat the party,
// and the resource exclusion constraint stays the last guard (a `23P01` is SLOT_TAKEN). Both are Run service's
// (`hospitality.service`), behind the Table seating gate.
//
// A walk in is the host's call, so opening hours, notice, the online flag and pacing don't apply: the party is
// already at the door. Only the tables' other holds do. The visit starts Seated, its clock running from now.
import { holdForParty, VISIT_LIMITS } from '@crm/contracts';
import type { WorkspaceTx } from '@crm/db';
import { sql } from 'drizzle-orm';
import { requirePermission } from '../access/check.ts';
import type { EngineScope } from '../access/mint.ts';
import { inWorkspace } from '../access/run.ts';
import { checkId, newId } from '../engine/ids.ts';
import { inputInvalid, postgresError, refuse } from '../engine/refusals.ts';
import { runWrite, type AfterWrite } from '../engine/write.ts';
import { auditSetup, hospitalityMember, requireApp } from '../hospitality/gate.ts';
import { newLookupCode, type SlotCache } from './book.ts';
import { loadVisitInputs, type VisitInputs } from './load.ts';
import { lockVisit } from './locks.ts';
import { partyGroups, type PlannerResource } from './planner.ts';
import { readTableService } from './table-service.ts';

/** The words when the tables went between the pick and the seat. */
export const WALK_IN_TAKEN = 'That table was just taken. Pick another.';

const MINUTE = 60_000;

/** One free table or tables joined, as the host picks it. */
export interface FreeTable {
  readonly resourceIds: readonly string[];
  /** "T1", or "T1 + T2" for tables joined. */
  readonly label: string;
  /** The seats together (their largest capacities summed). */
  readonly seats: number;
}

/** The tables free now for a party, best fit first, and how long the party would hold one. */
export interface FreeTables {
  readonly tables: readonly FreeTable[];
  readonly holdMinutes: number;
}

/** The party, checked: a whole number in the engine's range. */
function checkParty(party: number): number {
  if (!Number.isInteger(party) || party < VISIT_LIMITS.partyMin || party > VISIT_LIMITS.partyMax) {
    throw inputInvalid('party', 'Choose a party of 1 to 100.');
  }
  return party;
}

/** The place's Table service, or CONFLICT before the first setup save. */
async function tableServiceAt(tx: WorkspaceTx, placeId: string) {
  const service = await readTableService(tx, placeId);
  if (service === undefined) throw refuse('CONFLICT', 'Set up Table seating for this place first.');
  return service;
}

/** What a walk in at `now` would hold: the inputs at the place, and the hold's end. */
async function walkInputs(
  tx: WorkspaceTx,
  workspaceId: string,
  placeId: string,
  party: number,
  now: Date,
): Promise<{ readonly inputs: VisitInputs; readonly end: Date; readonly holdMinutes: number }> {
  const service = await tableServiceAt(tx, placeId);
  const holdMinutes = holdForParty(service.rules.minutes, service.rules.holds, party);
  const end = new Date(now.getTime() + holdMinutes * MINUTE);
  const inputs = await loadVisitInputs(tx, {
    workspaceId,
    placeId,
    items: [{ serviceId: service.serviceId, variantId: service.variantId }],
    party,
    from: now,
    to: end,
  });
  const after = (inputs.items[0]?.bufferAfter ?? 0) * MINUTE;
  return { inputs, end: new Date(end.getTime() + after), holdMinutes };
}

/** The tables free over [from, to), and the groups of them that seat the party, best fit first (the planner's order). */
function freeGroups(
  resources: readonly PlannerResource[],
  party: number,
  from: Date,
  to: Date,
): readonly (readonly PlannerResource[])[] {
  const free = resources.filter(
    (resource) =>
      resource.kind === 'table' &&
      !resource.busy.some((busy) => busy.start < to.getTime() && from.getTime() < busy.end),
  );
  return partyGroups(free, 'table', party).map((group) =>
    group.flatMap((index) => (free[index] === undefined ? [] : [free[index]])),
  );
}

/** The labels of the place's tables. */
async function labelsOf(tx: WorkspaceTx, placeId: string): Promise<ReadonlyMap<string, string>> {
  const rows = (
    await tx.execute<{ id: string; label: string }>(sql`
      select id::text, label from resources where place_id = ${placeId}::uuid and kind = 'table' and archived_at is null
    `)
  ).rows;
  return new Map(rows.map((row) => [row.id, row.label]));
}

/** Two id lists naming the same tables. */
const sameTables = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().join(',') === [...b].sort().join(',');

/** The tables free now that seat `party` at the place (Run service), best fit first. */
export async function freeTables(
  scope: EngineScope,
  input: { readonly placeId: string; readonly party: number },
  deps: { readonly now?: () => Date } = {},
): Promise<FreeTables> {
  requirePermission(scope, 'hospitality.service');
  const placeId = checkId(input.placeId, 'That place doesn’t exist.');
  const party = checkParty(input.party);
  const now = deps.now?.() ?? new Date();
  return inWorkspace(scope, async (tx) => {
    await requireApp(tx, scope.workspaceId, 'table_seating');
    const { inputs, end, holdMinutes } = await walkInputs(tx, scope.workspaceId, placeId, party, now);
    const labels = await labelsOf(tx, placeId);
    return {
      holdMinutes,
      tables: freeGroups(inputs.resources, party, now, end).map((group) => ({
        resourceIds: group.map((table) => table.id),
        label: group.map((table) => labels.get(table.id) ?? '').join(' + '),
        seats: group.reduce((sum, table) => sum + table.maxCapacity, 0),
      })),
    };
  });
}

/**
 * Seats a walk in now at `resourceIds` (Run service): under the place lock, those tables must still be free for the
 * party's whole hold and still seat it (alone, or joined as the planner joins them), else SLOT_TAKEN (taken
 * meanwhile) or INPUT_INVALID (they never seat the party). A retry of the same `idempotencyKey` answers the first
 * visit. The visit is Seated from now, source `walk_in`, with no client email (nothing is mailed).
 */
export async function seatWalkIn(
  scope: EngineScope,
  input: {
    readonly placeId: string;
    readonly party: number;
    readonly resourceIds: readonly string[];
    readonly name?: string | undefined;
    readonly idempotencyKey: string;
  },
  deps: { readonly now?: () => Date; readonly slotCache?: SlotCache } = {},
  hooks: readonly AfterWrite[] = [],
): Promise<{ readonly id: string; readonly status: 'started' }> {
  requirePermission(scope, 'hospitality.service');
  const by = hospitalityMember(scope);
  const placeId = checkId(input.placeId, 'That place doesn’t exist.');
  const party = checkParty(input.party);
  const key = checkId(input.idempotencyKey, 'Try again.');
  if (input.resourceIds.length === 0 || input.resourceIds.length > 3) {
    throw inputInvalid('resourceIds', 'Pick one table, or up to 3 joined.');
  }
  const asked = input.resourceIds.map((id) => checkId(id, 'That table doesn’t exist.'));
  const name = input.name?.trim() === undefined || input.name.trim() === '' ? 'Walk in' : input.name.trim();
  if (name.length > VISIT_LIMITS.clientNameMax) throw inputInvalid('name', 'Use 120 characters or fewer.');
  const now = deps.now?.() ?? new Date();
  try {
    const { result } = await runWrite(
      scope,
      async (context) => {
        const { tx } = context;
        await requireApp(tx, scope.workspaceId, 'table_seating');
        // Tables have no staff, so the place lock is the only one (the global order: place, then people).
        await lockVisit(tx, scope.workspaceId, placeId, []);
        const [again] = (
          await tx.execute<{ id: string }>(sql`
            select id::text from appointments where place_id = ${placeId}::uuid and idempotency_key = ${key}::uuid
          `)
        ).rows;
        if (again !== undefined) return { id: again.id, status: 'started' as const, placeId };
        const service = await tableServiceAt(tx, placeId);
        const { inputs, end } = await walkInputs(tx, scope.workspaceId, placeId, party, now);
        const free = freeGroups(inputs.resources, party, now, end);
        if (
          !free.some((group) =>
            sameTables(
              group.map((table) => table.id),
              asked,
            ),
          )
        ) {
          const anyTime = partyGroups(inputs.resources, 'table', party).some((group) =>
            sameTables(
              group.flatMap((index) => (inputs.resources[index] === undefined ? [] : [inputs.resources[index].id])),
              asked,
            ),
          );
          if (!anyTime) throw inputInvalid('resourceIds', `Those tables don’t seat ${String(party)} together.`);
          throw refuse('SLOT_TAKEN', WALK_IN_TAKEN);
        }
        const appointmentId = newId();
        const visitEnd = new Date(
          now.getTime() + holdForParty(service.rules.minutes, service.rules.holds, party) * MINUTE,
        );
        await tx.execute(sql`
          insert into appointments (workspace_id, id, place_id, client_name, party_size, starts_at, ends_at, status,
            source, lookup_code, idempotency_key, total_minor, currency, created_by_member_id, arrived_at, seated_at)
          values (${scope.workspaceId}::uuid, ${appointmentId}::uuid, ${placeId}::uuid, ${name}, ${party},
            ${now.toISOString()}::timestamptz, ${visitEnd.toISOString()}::timestamptz, 'started', 'walk_in',
            ${await freeCode(tx)}, ${key}::uuid, 0, ${inputs.currency}, ${by}::uuid,
            ${now.toISOString()}::timestamptz, ${now.toISOString()}::timestamptz)
        `);
        const [item] = (
          await tx.execute<{ id: string }>(sql`
            insert into appointment_items (workspace_id, appointment_id, service_id, variant_id, service_name,
              variant_name, starts_at, ends_at, price_minor, price_type, position)
            values (${scope.workspaceId}::uuid, ${appointmentId}::uuid, ${service.serviceId}::uuid,
              ${service.variantId}::uuid, ${inputs.facts[0]?.serviceName ?? 'Table'}, ${inputs.facts[0]?.variantName ?? 'Table'},
              ${now.toISOString()}::timestamptz, ${visitEnd.toISOString()}::timestamptz, 0, 'free', 0)
            returning id::text
          `)
        ).rows;
        if (item === undefined) throw new Error('The walk in was not stored.');
        for (const resourceId of asked) {
          await tx.execute(sql`
            insert into appointment_holds (workspace_id, appointment_id, item_id, place_id, resource_id, during)
            values (${scope.workspaceId}::uuid, ${appointmentId}::uuid, ${item.id}::uuid, ${placeId}::uuid,
              ${resourceId}::uuid, tstzrange(${now.toISOString()}::timestamptz, ${end.toISOString()}::timestamptz, '[)'))
          `);
        }
        await auditSetup(tx, scope, 'visit.created', { appointmentId, placeId, source: 'walk_in' });
        context.record({ visits: [placeId] });
        return { id: appointmentId, status: 'started' as const, placeId };
      },
      hooks,
    );
    deps.slotCache?.purge(placeId);
    return { id: result.id, status: result.status };
  } catch (error) {
    if (postgresError(error)?.code === '23P01') throw refuse('SLOT_TAKEN', WALK_IN_TAKEN);
    throw error;
  }
}

/** A lookup code no visit of the workspace has. */
async function freeCode(tx: WorkspaceTx): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = newLookupCode();
    const [used] = (await tx.execute(sql`select 1 from appointments where lookup_code = ${code} limit 1`)).rows;
    if (used === undefined) return code;
  }
  throw new Error('No free lookup code after five tries.');
}
