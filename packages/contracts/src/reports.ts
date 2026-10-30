// Saved reports (the reports lane, spec 0050 reserved): a chart's definition, shared with the workspace. The
// server stores the definition only; every figure a report draws is read through `records.aggregate` and
// `records.aggregateGroups` when it opens, so the access door and record rules decide what each reader sees. The
// rules for what a config can run (`reportProblem`) and the questions it asks (`planReport`) live in
// `report-model.ts`, without Zod, so the browser's data layer shares them with the engine.
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { REPORT_BUCKETS, REPORT_CHARTS } from './report-model.ts';
import { FilterGroup } from './values/filters.ts';
import { Uuid } from './values/ids.ts';
import { WorkspaceScoped } from './workspaces.ts';

/** The most bytes a report's settings take, serialised (`CONFIG_INVALID` past it). */
export const MAX_REPORT_CONFIG_BYTES = 16_384;

/** What a report works out: how many records, or the sum or average of a number or currency field. */
export const ReportMeasure = z.discriminatedUnion('fn', [
  z.strictObject({ fn: z.literal('count') }),
  z.strictObject({ fn: z.enum(['sum', 'avg']), attributeId: Uuid }),
]);
/** What a report works out. */
export type ReportMeasure = z.infer<typeof ReportMeasure>;

/** What a report groups by: a field, and for a date its period. */
export const ReportGroupBy = z.strictObject({ attributeId: Uuid, bucket: z.enum(REPORT_BUCKETS).optional() });
/** What a report groups by. */
export type ReportGroupBy = z.infer<typeof ReportGroupBy>;

/**
 * What a report stores. `filter` is a snapshot of a saved view's filter taken when the report was saved
 * (`filterName` is that view's name, for the label), `weights` the win chance (0 to 100) the person set per stage
 * option, for the forecast. Unknown keys are refused; the engine also checks the config runs on its object
 * (`reportProblem`) and that the filter does.
 */
export const ReportConfig = z.strictObject({
  measure: ReportMeasure,
  groupBy: ReportGroupBy.optional(),
  filter: FilterGroup.optional(),
  filterName: z.string().trim().min(1).max(100).optional(),
  chart: z.enum(REPORT_CHARTS),
  weights: z.record(z.uuid(), z.number().int().min(0).max(100)).optional(),
});
/** What a report stores. */
export type ReportConfig = z.infer<typeof ReportConfig>;

/** A report's name: 1 to 100 characters once trimmed. */
export const ReportName = z
  .string()
  .trim()
  .min(1, 'Give the report a name.')
  .max(100, 'A report name is at most 100 characters.');

/** One saved report, as the Reports page lists it. */
export const Report = z.object({
  id: Uuid,
  objectId: Uuid,
  name: z.string(),
  config: ReportConfig,
  creatorMemberId: Uuid.optional(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});
/** One saved report. */
export type Report = z.infer<typeof Report>;

/** The workspace's reports the caller may see, oldest first. */
export const ReportList = z.object({ reports: z.array(Report) });
/** The workspace's reports. */
export type ReportList = z.infer<typeof ReportList>;

/**
 * A new report. `id` is a UUID v7 the browser mints: the same create again by the same member answers the report
 * already made, and Undo after a delete puts the report back under it.
 */
export const CreateReportInput = WorkspaceScoped.extend({
  id: Uuid,
  objectId: Uuid,
  name: ReportName,
  config: ReportConfig,
});
/** A new report. */
export type CreateReportInput = z.infer<typeof CreateReportInput>;

/** A rename, new settings, or both. */
export const UpdateReportInput = WorkspaceScoped.extend({
  reportId: Uuid,
  name: ReportName.optional(),
  config: ReportConfig.optional(),
});
/** A rename, new settings, or both. */
export type UpdateReportInput = z.infer<typeof UpdateReportInput>;

/** Deletes a report. */
export const DeleteReportInput = WorkspaceScoped.extend({ reportId: Uuid });
/** Deletes a report. */
export type DeleteReportInput = z.infer<typeof DeleteReportInput>;

/** A delete's answer. */
export const ReportDeleted = z.object({ deleted: z.literal(true) });
/** A delete's answer. */
export type ReportDeleted = z.infer<typeof ReportDeleted>;

/**
 * Saved reports. `list` answers the reports on objects the caller may read (a hidden object's reports are absent,
 * never locked). `create` answers 404 `NOT_FOUND` for an object the caller can't read, 422 `CONFIG_INVALID` for
 * settings the object can't run, `FILTER_INVALID` for a filter it can't, 409 `ID_TAKEN` for an id another report
 * holds and `LIMIT_REACHED` past 200 reports. `update` and `delete` are the maker's, or a holder of `views.manage`:
 * anyone else who can see the report gets 403 `FORBIDDEN`, and one who can't gets `NOT_FOUND`.
 */
export const reportsContract = {
  list: oc.input(WorkspaceScoped).output(ReportList),
  create: oc.input(CreateReportInput).output(Report),
  update: oc.input(UpdateReportInput).output(Report),
  delete: oc.input(DeleteReportInput).output(ReportDeleted),
};
