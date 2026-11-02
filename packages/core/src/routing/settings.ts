// The workspace's routing settings (spec 0037, AC-1351, AC-1385): one `routing_settings` row, made by the first
// setting stored; without it the defaults hold. L7 keeps Won means, the Deals stage field (api slug `stage`) and the
// stages that count as won, which Known's Customer (AC-1393) and the Deals won objective (AC-1354) read. Holders of
// `routing.manage` only. A change names the `updatedAt` it read (409 `STALE` otherwise) and writes one
// `routing.settings_changed` audit row with before and after. Settings, so no outbox row: screens read them again.
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  FIT_LINKS_MAX,
  HOLDOUT_PERCENT_DEFAULT,
  HOLDOUT_PERCENT_MAX,
  SEGMENT_ATTRIBUTES_MAX,
  SEGMENT_OPTIONS_MAX,
  SMART_MODE_DEFAULT,
  smartModeOf,
  TILT_PERCENT_DEFAULT,
  TILT_PERCENT_MAX,
  WonStage,
  type FitLink,
  type RoutingSettings,
  type SetRoutingSettingsInput,
  type SmartMode,
} from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import { requirePermission } from '../access/check.ts';
import type { EngineScope } from '../access/mint.ts';
import { inWorkspace } from '../access/run.ts';
import { refuse, refuseOn } from '../engine/refusals.ts';
import { actorRow } from '../engine/scope.ts';
import { writeAudit } from '../members/audit.ts';
import { fitLinksOf } from './fit.ts';

const { attributeOptions, attributes, objects, routingSettings, routingSkills } = schema;

const STALE_MESSAGE = 'Someone else changed the routing settings. Look again and try once more.';
const NOT_STAGE = 'Pick stages of the Deals Stage field.';
const FIT_UNKNOWN = 'Link options of live fields on People, Companies or Deals to live skills.';
const SEGMENT_UNKNOWN = `Pick live select or status fields of Companies or Deals with at most ${String(SEGMENT_OPTIONS_MAX)} options.`;

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
      smartMode: routingSettings.smartMode,
      tiltPercent: routingSettings.tiltPercent,
      fit: routingSettings.fit,
      holdoutPercent: routingSettings.holdoutPercent,
      segmentAttributeIds: routingSettings.segmentAttributeIds,
      learnSince: routingSettings.learnSince,
      modelVersion: routingSettings.modelVersion,
      modelTrainedAt: sql<
        string | null
      >`to_char(${routingSettings.modelTrainedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
      updatedAt: sql<string>`to_char(${routingSettings.updatedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
    })
    .from(routingSettings);
  const [row] = lock ? await query.for('update') : await query;
  if (row === undefined) return {};
  const wonStage = wonStageOf(row.wonStage);
  return {
    ...(wonStage === undefined ? {} : { wonStage }),
    ...(row.smartMode === null ? {} : { smartMode: smartModeOf(row.smartMode) }),
    ...(row.tiltPercent === null ? {} : { tiltPercent: row.tiltPercent }),
    ...(row.fit === null ? {} : { fit: [...fitLinksOf(row.fit)] }),
    ...(row.holdoutPercent === null ? {} : { holdoutPercent: row.holdoutPercent }),
    ...(row.segmentAttributeIds === null ? {} : { segmentAttributeIds: [...row.segmentAttributeIds] }),
    ...(row.learnSince === null ? {} : { learnSince: row.learnSince }),
    modelVersion: row.modelVersion,
    ...(row.modelTrainedAt === null ? {} : { modelTrainedAt: row.modelTrainedAt }),
    updatedAt: row.updatedAt,
  };
}

/** The smart ranking's settings as the booking path reads them: the stored values, else the code's defaults (AC-1363). */
export interface SmartSettings {
  readonly mode: SmartMode;
  readonly tiltPercent: number;
  readonly fit: readonly FitLink[];
  /** The model the lift comes from; 0 until the nightly run has trained one (AC-1381). */
  readonly modelVersion: number;
  /** The share of ranked decisions drawn into the holdout, 0 to 20 percent (AC-1389). */
  readonly holdoutPercent: number;
  /** The segment attributes, in the order they decide the key (AC-1370); empty is one all segments cell. */
  readonly segmentAttributeIds: readonly string[];
}

/** The defaults a workspace with no settings row runs. */
export const SMART_DEFAULTS: SmartSettings = {
  mode: SMART_MODE_DEFAULT,
  tiltPercent: TILT_PERCENT_DEFAULT,
  fit: [],
  modelVersion: 0,
  holdoutPercent: HOLDOUT_PERCENT_DEFAULT,
  segmentAttributeIds: [],
};

/**
 * The smart ranking's settings, for a booking and for Test: read in the
 * caller's transaction, before any lock. No row, or a column never set, is
 * the default; a mode the code doesn't know is `off` and a stored allowance
 * out of range is clamped, so nothing unknown ever tilts a pick (AC-1223).
 */
export async function readSmartSettings(tx: WorkspaceTx): Promise<SmartSettings> {
  const [row] = await tx
    .select({
      smartMode: routingSettings.smartMode,
      tiltPercent: routingSettings.tiltPercent,
      fit: routingSettings.fit,
      holdoutPercent: routingSettings.holdoutPercent,
      segmentAttributeIds: routingSettings.segmentAttributeIds,
      modelVersion: routingSettings.modelVersion,
    })
    .from(routingSettings);
  if (row === undefined) return SMART_DEFAULTS;
  return {
    mode: smartModeOf(row.smartMode),
    tiltPercent:
      row.tiltPercent === null ? TILT_PERCENT_DEFAULT : Math.min(TILT_PERCENT_MAX, Math.max(0, row.tiltPercent)),
    fit: fitLinksOf(row.fit),
    modelVersion: Math.max(0, row.modelVersion),
    holdoutPercent:
      row.holdoutPercent === null
        ? HOLDOUT_PERCENT_DEFAULT
        : Math.min(HOLDOUT_PERCENT_MAX, Math.max(0, row.holdoutPercent)),
    // At most two, whatever the row holds: a stored third would split cells the run never writes (AC-1223).
    segmentAttributeIds: (row.segmentAttributeIds ?? []).slice(0, SEGMENT_ATTRIBUTES_MAX),
  };
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

/** Refuses a fit link whose field, option or skill isn't live (AC-1362): nothing unknown ever reaches the ranking. */
async function checkFit(tx: WorkspaceTx, links: readonly FitLink[]): Promise<void> {
  if (links.length === 0) return;
  if (links.length > FIT_LINKS_MAX) throw refuseOn('CONFIG_INVALID', FIT_UNKNOWN, 'fit');
  const optionIds = [...new Set(links.map((link) => link.optionId))];
  const live = await tx
    .select({ id: attributeOptions.id, attributeId: attributeOptions.attributeId })
    .from(attributeOptions)
    .innerJoin(
      attributes,
      and(eq(attributes.workspaceId, attributeOptions.workspaceId), eq(attributes.id, attributeOptions.attributeId)),
    )
    .innerJoin(objects, and(eq(objects.workspaceId, attributes.workspaceId), eq(objects.id, attributes.objectId)))
    .where(
      and(
        inArray(attributeOptions.id, optionIds),
        isNull(attributeOptions.archivedAt),
        isNull(attributes.archivedAt),
        isNull(objects.archivedAt),
        sql`${attributes.type}::text in ('status', 'select')`,
        sql`${objects.standardKey} in ('people', 'companies', 'deals')`,
      ),
    );
  const onField = new Map(live.map((row) => [row.id, row.attributeId]));
  if (links.some((link) => onField.get(link.optionId) !== link.attributeId)) {
    throw refuseOn('CONFIG_INVALID', FIT_UNKNOWN, 'fit');
  }
  const skillIds = [...new Set(links.map((link) => link.skillId))];
  const skills = await tx
    .select({ id: routingSkills.id })
    .from(routingSkills)
    .where(inArray(routingSkills.id, skillIds));
  if (skills.length !== skillIds.length) throw refuseOn('CONFIG_INVALID', FIT_UNKNOWN, 'fit');
}

/**
 * Refuses a segment attribute that isn't a live select or status field of
 * Companies or Deals with at most six live options (AC-1370). People are
 * never allowed: a segment must describe the lead's company or deal, not the
 * person, which is what keeps learning off anything about an individual.
 */
async function checkSegments(tx: WorkspaceTx, attributeIds: readonly string[]): Promise<void> {
  if (attributeIds.length === 0) return;
  if (attributeIds.length > SEGMENT_ATTRIBUTES_MAX)
    throw refuseOn('CONFIG_INVALID', SEGMENT_UNKNOWN, 'segmentAttributeIds');
  const live = await tx
    .select({
      id: attributes.id,
      options: sql<number>`(
        select count(*) from attribute_options o
        where o.workspace_id = ${attributes.workspaceId} and o.attribute_id = ${attributes.id} and o.archived_at is null
      )`,
    })
    .from(attributes)
    .innerJoin(objects, and(eq(objects.workspaceId, attributes.workspaceId), eq(objects.id, attributes.objectId)))
    .where(
      and(
        inArray(attributes.id, [...attributeIds]),
        isNull(attributes.archivedAt),
        isNull(objects.archivedAt),
        sql`${attributes.type}::text in ('status', 'select')`,
        sql`${objects.standardKey} in ('companies', 'deals')`,
      ),
    );
  const ok = new Set(live.filter((row) => row.options > 0 && row.options <= SEGMENT_OPTIONS_MAX).map((row) => row.id));
  if (attributeIds.some((id) => !ok.has(id))) throw refuseOn('CONFIG_INVALID', SEGMENT_UNKNOWN, 'segmentAttributeIds');
}

/** A fit link list stored as plain rows, in the order it was given, so the audit row reads the same twice. */
const fitRows = (links: readonly FitLink[]) =>
  links.map((link) => ({ attributeId: link.attributeId, optionId: link.optionId, skillId: link.skillId }));

/**
 * Sets the workspace's routing settings (AC-1351, AC-1363, AC-1374, AC-1385,
 * AC-1370, AC-1386, AC-1389): Won means (null clears it), the smart mode, the
 * fairness allowance, the fit links, the holdout share, the segment
 * attributes and Learn from (null clears it). A field left out stays as it is. Under the settings row's lock:
 * the `updatedAt` read must still be the row's (absent: no row yet), or 409
 * `STALE`. One `routing.settings_changed` audit row with before and after of
 * only the fields that changed; nothing changed writes nothing.
 */
export async function setRoutingSettings(
  scope: EngineScope,
  input: Pick<
    SetRoutingSettingsInput,
    | 'wonStage'
    | 'smartMode'
    | 'tiltPercent'
    | 'fit'
    | 'holdoutPercent'
    | 'segmentAttributeIds'
    | 'learnSince'
    | 'updatedAt'
  >,
): Promise<RoutingSettings> {
  requirePermission(scope, 'routing.manage');
  return inWorkspace(scope, async (tx) => {
    // The first setting stored makes the row: the lock keeps two first writes from both thinking there was none.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`routing_settings:${scope.workspaceId}`}, 0))`,
    );
    const before = await readSettings(tx, true);
    if (before.updatedAt !== input.updatedAt) throw refuse('STALE', STALE_MESSAGE);
    if (input.wonStage !== undefined && input.wonStage !== null) await checkWonStage(tx, input.wonStage);
    if (input.fit !== undefined) await checkFit(tx, input.fit);
    if (input.segmentAttributeIds !== undefined) await checkSegments(tx, input.segmentAttributeIds);
    const wonStage =
      input.wonStage === undefined
        ? (before.wonStage ?? null)
        : input.wonStage === null
          ? null
          : { ...input.wonStage, optionIds: [...input.wonStage.optionIds] };
    const smartMode = input.smartMode ?? before.smartMode ?? null;
    const tiltPercent = input.tiltPercent ?? before.tiltPercent ?? null;
    const fit = input.fit === undefined ? (before.fit === undefined ? null : fitRows(before.fit)) : fitRows(input.fit);
    const holdoutPercent = input.holdoutPercent ?? before.holdoutPercent ?? null;
    const segmentAttributeIds =
      input.segmentAttributeIds === undefined ? (before.segmentAttributeIds ?? null) : [...input.segmentAttributeIds];
    const learnSince =
      input.learnSince === undefined
        ? (before.learnSince ?? null)
        : input.learnSince === null
          ? null
          : input.learnSince;
    const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
    const changed: Record<string, readonly [unknown, unknown]> = {
      ...(same(before.wonStage, wonStage) ? {} : { wonStage: [before.wonStage ?? null, wonStage] as const }),
      ...(same(before.smartMode, smartMode) ? {} : { smartMode: [before.smartMode ?? null, smartMode] as const }),
      ...(same(before.tiltPercent, tiltPercent)
        ? {}
        : { tiltPercent: [before.tiltPercent ?? null, tiltPercent] as const }),
      ...(same(before.fit, fit) ? {} : { fit: [before.fit ?? null, fit] as const }),
      ...(same(before.holdoutPercent, holdoutPercent)
        ? {}
        : { holdoutPercent: [before.holdoutPercent ?? null, holdoutPercent] as const }),
      ...(same(before.segmentAttributeIds, segmentAttributeIds)
        ? {}
        : { segmentAttributeIds: [before.segmentAttributeIds ?? null, segmentAttributeIds] as const }),
      ...(same(before.learnSince, learnSince) ? {} : { learnSince: [before.learnSince ?? null, learnSince] as const }),
    };
    if (Object.keys(changed).length === 0) return before;
    const by = actorRow(scope.actor);
    await tx
      .insert(routingSettings)
      .values({
        workspaceId: scope.workspaceId,
        wonStage,
        smartMode,
        tiltPercent,
        fit,
        holdoutPercent,
        segmentAttributeIds,
        learnSince,
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
          smartMode,
          tiltPercent,
          fit,
          holdoutPercent,
          segmentAttributeIds,
          learnSince,
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
      before: Object.fromEntries(Object.entries(changed).map(([field, pair]) => [field, pair[0]])),
      after: Object.fromEntries(Object.entries(changed).map(([field, pair]) => [field, pair[1]])),
    });
    return readSettings(tx);
  });
}
