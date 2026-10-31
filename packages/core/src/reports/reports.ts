// Saved reports (the reports lane, spec 0050 reserved): a chart's definition, shared with the workspace. The
// database holds the definition and nothing else; every figure is read through `records.aggregate` and
// `records.aggregateGroups` when the report opens, so the access door and record rules decide what each reader
// sees. A report is listed to a reader only when they can read its object and every field it names (its measure,
// its group by and its filter): hidden means absent, so a name or a value in a filter never reaches someone who
// may not see that field. Its maker, or a holder of `views.manage`, changes or deletes it. These writes store no
// outbox row (a report holds no records), so another tab reads the list again when it opens it.
import { and, asc, count, eq } from 'drizzle-orm';
import { MAX_REPORT_CONFIG_BYTES, ReportConfig, type Report, type ReportList } from '@crm/contracts';
import { reportProblem, type ReportAttribute } from '@crm/contracts/reports';
import { filterAttributeIds } from '@crm/contracts/views';
import { schema, type WorkspaceTx } from '@crm/db';
import { touched } from '../engine/definitions.ts';
import { checkId, isUuidV7 } from '../engine/ids.ts';
import { limitsOf } from '../engine/limits.ts';
import { checkViewQuery } from '../engine/query/page.ts';
import { postgresError, refuse, refuseOn } from '../engine/refusals.ts';
import type { EngineScope } from '../engine/scope.ts';
import { isArchivedNow, loadAttributes, loadAttributesById } from '../engine/values.ts';
import { attributeVisible, checkObject } from '../access/visibility.ts';
import { can, isOpen, objectLevel } from '../access/policy.ts';
import { inWorkspace } from '../access/run.ts';

const { reports } = schema;

/** What every call naming a report the caller can't see answers, whichever reason it was. */
export const REPORT_NOT_FOUND = "This report doesn't exist or isn't shared with you.";

/** What a change by someone who is neither its maker nor a holder of `views.manage` answers. */
export const REPORT_NOT_YOURS = 'Only the person who made this report, or an admin, can change it.';

/** A new report: its id (a UUID v7 the browser mints once), object, name and settings. */
export interface NewReport {
  readonly id: string;
  readonly objectId: string;
  readonly name: string;
  readonly config: ReportConfig;
}

/** A rename, new settings, or both. */
export interface ReportChange {
  readonly reportId: string;
  readonly name?: string | undefined;
  readonly config?: ReportConfig | undefined;
}

/** The columns a report read selects. */
const COLUMNS = {
  id: reports.id,
  objectId: reports.objectId,
  name: reports.name,
  config: reports.config,
  creatorMemberId: reports.creatorMemberId,
  createdAt: reports.createdAt,
  updatedAt: reports.updatedAt,
} as const;

/** One report row as the reads select it. */
interface ReportRow {
  readonly id: string;
  readonly objectId: string;
  readonly name: string;
  readonly config: unknown;
  readonly creatorMemberId: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

const memberOf = (scope: EngineScope): string | undefined =>
  scope.actor.type === 'member' && scope.actor.id !== null ? scope.actor.id : undefined;

/** The stored config as it parses, or undefined when it doesn't (a bug, a downgrade): such a report is left out. */
function configOf(stored: unknown): ReportConfig | undefined {
  const parsed = ReportConfig.safeParse(stored);
  return parsed.success ? parsed.data : undefined;
}

/** Every attribute id a config names: its measure, its group by, and every field of its filter, at any hop. */
function namedBy(config: ReportConfig): readonly string[] {
  return [
    ...(config.measure.fn === 'count' ? [] : [config.measure.attributeId]),
    ...(config.groupBy === undefined ? [] : [config.groupBy.attributeId]),
    ...filterAttributeIds(config.filter),
  ];
}

/**
 * The ids among `ids` the caller may see, each judged on its own object (a filter reaches a far object through a
 * `through` path): the object not hidden from them, and the field not hidden by a field rule.
 */
async function seenAmong(tx: WorkspaceTx, scope: EngineScope, ids: readonly string[]): Promise<ReadonlySet<string>> {
  if (ids.length === 0) return new Set();
  if (isOpen(scope.access)) return new Set(ids);
  const found = await loadAttributesById(tx, ids);
  return new Set(
    [...found.values()].flatMap((attribute) =>
      attribute.objectId !== null &&
      objectLevel(scope.access, attribute.objectId) !== 'none' &&
      attributeVisible(scope.access, attribute)
        ? [attribute.id]
        : [],
    ),
  );
}

function reportOf(row: ReportRow, config: ReportConfig): Report {
  return {
    id: row.id,
    objectId: row.objectId,
    name: row.name,
    config,
    ...(row.creatorMemberId === null ? {} : { creatorMemberId: row.creatorMemberId }),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** The reports among `rows` the caller may see, as `Report`s: object readable, every named field visible. */
async function visibleReports(tx: WorkspaceTx, scope: EngineScope, rows: readonly ReportRow[]): Promise<Report[]> {
  const parsed = rows.flatMap((row) => {
    const config = configOf(row.config);
    const readable = isOpen(scope.access) || objectLevel(scope.access, row.objectId) !== 'none';
    return config === undefined || !readable ? [] : [{ row, config }];
  });
  const seen = await seenAmong(tx, scope, [...new Set(parsed.flatMap(({ config }) => namedBy(config)))]);
  return parsed
    .filter(({ config }) => namedBy(config).every((id) => seen.has(id)))
    .map(({ row, config }) => reportOf(row, config));
}

/**
 * The workspace's reports the caller may see, oldest first. A report on an object they can't read, or naming a
 * field a field rule hides from them (in its measure, group by or filter), is absent, never locked.
 */
export async function listReports(scope: EngineScope): Promise<ReportList> {
  return inWorkspace(scope, async (tx) => {
    const rows = await tx
      .select(COLUMNS)
      .from(reports)
      .where(eq(reports.workspaceId, scope.workspaceId))
      .orderBy(asc(reports.createdAt), asc(reports.id));
    return { reports: await visibleReports(tx, scope, rows) };
  });
}

/** The object's attributes as the caller sees them, in the shape the report rules read. */
async function reportAttributes(tx: WorkspaceTx, scope: EngineScope, objectId: string): Promise<ReportAttribute[]> {
  const found = await loadAttributes(tx, objectId);
  return [...found.values()]
    .filter((attribute) => attributeVisible(scope.access, attribute))
    .map((attribute) => ({
      id: attribute.id,
      type: attribute.type,
      isMulti: attribute.isMulti,
      isSystem: attribute.isSystem,
      isPrimary: false,
      isArchived: isArchivedNow(attribute),
      position: attribute.position,
      apiSlug: attribute.apiSlug,
      title: attribute.title,
    }));
}

/** Refuses settings the object can't run: the config's own rules, then the filter as a read would compile it. */
async function checkConfig(tx: WorkspaceTx, scope: EngineScope, objectId: string, config: ReportConfig): Promise<void> {
  if (JSON.stringify(config).length > MAX_REPORT_CONFIG_BYTES) {
    throw refuse('CONFIG_INVALID', 'This report’s settings are too big.');
  }
  const problem = reportProblem(config, await reportAttributes(tx, scope, objectId));
  if (problem !== undefined) throw refuse('CONFIG_INVALID', problem);
  const filter = config.filter === undefined || config.filter.conditions.length === 0 ? undefined : config.filter;
  await checkViewQuery(tx, scope, { objectId, ...(filter === undefined ? {} : { filter }), sorts: [] });
}

/** A name is 1 to 100 characters once trimmed. */
function nameOf(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > 100) {
    throw refuseOn('CONFIG_INVALID', 'A report name is 1 to 100 characters.', 'name');
  }
  return trimmed;
}

/** The settings as stored: a filter with no conditions is none. */
function storedConfig(config: ReportConfig): ReportConfig {
  const parsed = ReportConfig.safeParse(config);
  if (!parsed.success) throw refuse('CONFIG_INVALID', 'This report’s settings are not valid.');
  const { filter, ...rest } = parsed.data;
  return filter === undefined || filter.conditions.length === 0 ? rest : { ...rest, filter };
}

/**
 * Saves a new report on an object the caller may read. The same id by the same member answers the report already
 * made (a retry, or Undo after the same delete finds it gone and makes it again); an id another report holds is
 * `ID_TAKEN`. Refuses `CONFIG_INVALID` for settings the object can't run, `FILTER_INVALID` for a filter it can't,
 * and `LIMIT_REACHED` past the workspace's reports.
 */
export async function createReport(scope: EngineScope, input: NewReport): Promise<Report> {
  const objectId = checkId(input.objectId, 'That object does not exist.');
  if (!isUuidV7(input.id)) throw refuse('CONFIG_INVALID', 'The report id must be a UUID v7.');
  const id = input.id.toLowerCase();
  const name = nameOf(input.name);
  const config = storedConfig(input.config);
  const creator = memberOf(scope) ?? null;
  return inWorkspace(scope, async (tx) => {
    await checkObject(tx, scope.access, objectId, 'read');
    const [earlier] = await tx
      .select({ ...COLUMNS, createdById: reports.createdById })
      .from(reports)
      .where(and(eq(reports.workspaceId, scope.workspaceId), eq(reports.id, id)));
    if (earlier !== undefined) {
      const isOwnTry = earlier.objectId === objectId && earlier.createdById === (scope.actor.id ?? null);
      const stored = configOf(earlier.config);
      if (!isOwnTry || stored === undefined) throw refuse('ID_TAKEN', 'A report with that id already exists.');
      return reportOf(earlier, stored);
    }
    await checkConfig(tx, scope, objectId, config);
    const [held] = await tx.select({ n: count() }).from(reports).where(eq(reports.workspaceId, scope.workspaceId));
    const limit = limitsOf(scope).reportsPerWorkspace;
    if ((held?.n ?? 0) >= limit) {
      throw refuse('LIMIT_REACHED', `A workspace can keep at most ${String(limit)} reports. Delete one first.`);
    }
    const by = touched(scope);
    try {
      await tx.insert(reports).values({
        workspaceId: scope.workspaceId,
        id,
        objectId,
        name,
        config,
        creatorMemberId: creator,
        createdByType: by.updatedByType,
        createdById: by.updatedById,
        createdByMemberId: by.updatedByMemberId,
        updatedByType: by.updatedByType,
        updatedById: by.updatedById,
        updatedByMemberId: by.updatedByMemberId,
      });
    } catch (error) {
      if (postgresError(error)?.code === '23505') throw refuse('ID_TAKEN', 'A report with that id already exists.');
      throw error;
    }
    return reportOf(await readRow(tx, scope, id), config);
  });
}

/** One row by id, inside `tx`, `for no key update` when a write changes it. */
async function readRow(tx: WorkspaceTx, scope: EngineScope, id: string, lock = false): Promise<ReportRow> {
  const query = tx
    .select(COLUMNS)
    .from(reports)
    .where(and(eq(reports.workspaceId, scope.workspaceId), eq(reports.id, id)));
  const [row] = lock ? await query.for('no key update') : await query;
  if (row === undefined) throw refuse('NOT_FOUND', REPORT_NOT_FOUND);
  return row;
}

/**
 * One report the caller may change: it exists and is theirs to see (`NOT_FOUND` with one message for every reason
 * it isn't), and they made it or hold `views.manage` (`FORBIDDEN` otherwise).
 */
async function changeable(tx: WorkspaceTx, scope: EngineScope, reportId: string): Promise<ReportRow> {
  const id = checkId(reportId, REPORT_NOT_FOUND);
  const row = await readRow(tx, scope, id, true);
  await checkObject(tx, scope.access, row.objectId, 'read', REPORT_NOT_FOUND);
  const [seen] = await visibleReports(tx, scope, [row]);
  if (seen === undefined) throw refuse('NOT_FOUND', REPORT_NOT_FOUND);
  const caller = memberOf(scope);
  if (!can(scope.access, 'views.manage') && (caller === undefined || row.creatorMemberId !== caller)) {
    throw refuse('FORBIDDEN', REPORT_NOT_YOURS);
  }
  return row;
}

/** Renames a report, replaces its settings, or both: its maker's, or a holder of `views.manage`. */
export async function updateReport(scope: EngineScope, input: ReportChange): Promise<Report> {
  const name = input.name === undefined ? undefined : nameOf(input.name);
  const config = input.config === undefined ? undefined : storedConfig(input.config);
  return inWorkspace(scope, async (tx) => {
    const row = await changeable(tx, scope, input.reportId);
    if (config !== undefined) await checkConfig(tx, scope, row.objectId, config);
    const by = touched(scope);
    await tx
      .update(reports)
      .set({
        ...(name === undefined ? {} : { name }),
        ...(config === undefined ? {} : { config }),
        updatedAt: by.updatedAt,
        updatedByType: by.updatedByType,
        updatedById: by.updatedById,
        updatedByMemberId: by.updatedByMemberId,
      })
      .where(and(eq(reports.workspaceId, scope.workspaceId), eq(reports.id, row.id)));
    const changed = await readRow(tx, scope, row.id);
    const stored = configOf(changed.config);
    if (stored === undefined) throw refuse('NOT_FOUND', REPORT_NOT_FOUND);
    return reportOf(changed, stored);
  });
}

/** Deletes a report for good: its maker's, or a holder of `views.manage`. Undo makes it again under the same id. */
export async function deleteReport(
  scope: EngineScope,
  input: { readonly reportId: string },
): Promise<{ readonly deleted: true }> {
  return inWorkspace(scope, async (tx) => {
    const row = await changeable(tx, scope, input.reportId);
    await tx.delete(reports).where(and(eq(reports.workspaceId, scope.workspaceId), eq(reports.id, row.id)));
    return { deleted: true } as const;
  });
}
