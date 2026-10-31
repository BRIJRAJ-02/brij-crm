// The workspace's routing settings (spec 0037, AC-1351, AC-1385): one `routing_settings` row, made by the first
// setting stored; without it the defaults hold. L7 keeps Won means, the Deals stage field (api slug `stage`) and the
// stages that count as won, which Known's Customer (AC-1393) and the Deals won objective (AC-1354) read. Holders of
// `routing.manage` only. A change names the `updatedAt` it read (409 `STALE` otherwise) and writes one
// `routing.settings_changed` audit row with before and after. Settings, so no outbox row: screens read them again.
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { WonStage, type RoutingSettings, type SetRoutingSettingsInput } from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import { requirePermission } from '../access/check.ts';
import type { EngineScope } from '../access/mint.ts';
import { inWorkspace } from '../access/run.ts';
import { refuse, refuseOn } from '../engine/refusals.ts';
import { actorRow } from '../engine/scope.ts';
import { writeAudit } from '../members/audit.ts';

const { attributeOptions, attributes, objects, routingSettings } = schema;

const STALE_MESSAGE = 'Someone else changed the routing settings. Look again and try once more.';
const NOT_STAGE = 'Pick stages of the Deals Stage field.';

/** The stored Won means, read defensively: one that doesn't parse is unset. */
export function wonStageOf(stored: unknown): WonStage | undefined {
  const parsed = WonStage.safeParse(stored);
  return parsed.success ? parsed.data : undefined;
}

/** The settings as stored, with `updatedAt` to the millisecond (what a change names back). */
async function readSettings(tx: WorkspaceTx, lock = false): Promise<RoutingSettings> {
  const query = tx
    .select({
      wonStage: routingSettings.wonStage,
      updatedAt: sql<string>`to_char(${routingSettings.updatedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
    })
    .from(routingSettings);
  const [row] = lock ? await query.for('update') : await query;
  if (row === undefined) return {};
  const wonStage = wonStageOf(row.wonStage);
  return { ...(wonStage === undefined ? {} : { wonStage }), updatedAt: row.updatedAt };
}

/** Won means, for a booking's facts and Test: read in the caller's transaction. */
export async function readWonStage(tx: WorkspaceTx): Promise<WonStage | undefined> {
  const [row] = await tx.select({ wonStage: routingSettings.wonStage }).from(routingSettings);
  return wonStageOf(row?.wonStage);
}

/** The workspace's routing settings (AC-1351): `routing.manage`. */
export async function getRoutingSettings(scope: EngineScope): Promise<RoutingSettings> {
  requirePermission(scope, 'routing.manage');
  return inWorkspace(scope, (tx) => readSettings(tx));
}

/** Refuses a Won means that isn't Deals' live Stage field and some of its live options. */
async function checkWonStage(tx: WorkspaceTx, wonStage: WonStage): Promise<void> {
  const [field] = await tx
    .select({ id: attributes.id })
    .from(attributes)
    .innerJoin(objects, and(eq(objects.workspaceId, attributes.workspaceId), eq(objects.id, attributes.objectId)))
    .where(
      and(
        eq(attributes.id, wonStage.attributeId),
        eq(attributes.apiSlug, 'stage'),
        eq(objects.standardKey, 'deals'),
        isNull(attributes.archivedAt),
        sql`${attributes.type}::text in ('status', 'select')`,
      ),
    );
  if (field === undefined) throw refuseOn('CONFIG_INVALID', NOT_STAGE, 'wonStage');
  const options = await tx
    .select({ id: attributeOptions.id })
    .from(attributeOptions)
    .where(
      and(
        eq(attributeOptions.attributeId, field.id),
        inArray(attributeOptions.id, [...wonStage.optionIds]),
        isNull(attributeOptions.archivedAt),
      ),
    );
  if (options.length !== wonStage.optionIds.length) throw refuseOn('CONFIG_INVALID', NOT_STAGE, 'wonStage');
}

/**
 * Sets Won means (AC-1385), or clears it with null. Under the settings row's lock: the `updatedAt` read must still be
 * the row's (absent: no row yet), or 409 `STALE`.
 */
export async function setRoutingSettings(
  scope: EngineScope,
  input: Pick<SetRoutingSettingsInput, 'wonStage' | 'updatedAt'>,
): Promise<RoutingSettings> {
  requirePermission(scope, 'routing.manage');
  return inWorkspace(scope, async (tx) => {
    // The first setting stored makes the row: the lock keeps two first writes from both thinking there was none.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`routing_settings:${scope.workspaceId}`}, 0))`,
    );
    const before = await readSettings(tx, true);
    if (before.updatedAt !== input.updatedAt) throw refuse('STALE', STALE_MESSAGE);
    if (input.wonStage !== null) await checkWonStage(tx, input.wonStage);
    const wonStage = input.wonStage === null ? null : { ...input.wonStage, optionIds: [...input.wonStage.optionIds] };
    if (JSON.stringify(before.wonStage ?? null) === JSON.stringify(wonStage)) return before;
    const by = actorRow(scope.actor);
    await tx
      .insert(routingSettings)
      .values({
        workspaceId: scope.workspaceId,
        wonStage,
        createdByType: by.type,
        createdById: by.id,
        createdByMemberId: by.memberId,
        updatedByType: by.type,
        updatedById: by.id,
        updatedByMemberId: by.memberId,
      })
      .onConflictDoUpdate({
        target: routingSettings.workspaceId,
        set: {
          wonStage,
          updatedAt: sql`now()`,
          updatedByType: by.type,
          updatedById: by.id,
          updatedByMemberId: by.memberId,
        },
      });
    await writeAudit(tx, scope.workspaceId, scope.actor, {
      action: 'routing.settings_changed',
      targetType: 'workspace',
      targetId: scope.workspaceId,
      before: { wonStage: before.wonStage ?? null },
      after: { wonStage },
    });
    return readSettings(tx);
  });
}
