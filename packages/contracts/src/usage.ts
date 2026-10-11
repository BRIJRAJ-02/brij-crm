// How much of each limit a workspace uses (spec 0012, AC-243): the settings
// meters read it. The counts are the ones the limits module checks, filtered
// by the caller's access, so a hidden object and its count are absent.
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { WorkspaceScoped } from './workspaces.ts';

/** One count against its limit. */
export const UsageCount = z.object({
  used: z.number().int().min(0),
  limit: z.number().int().min(0),
});
/** One count against its limit. */
export type UsageCount = z.infer<typeof UsageCount>;

/**
 * The workspace's usage: its custom objects (archived ones keep their slot),
 * only for a caller with `schema.manage`; each object the caller can see with
 * its attributes (non system, archived included, counting only those the
 * caller can see); and how many live options one attribute may hold.
 */
export const Usage = z.object({
  customObjects: UsageCount.optional(),
  attributes: z.record(z.uuid(), UsageCount),
  optionsPerAttribute: z.number().int().min(0),
});
/** The workspace's usage. */
export type Usage = z.infer<typeof Usage>;

/** A workspace's usage of its limits. A non member gets 404 `NOT_FOUND`. */
export const usageContract = {
  get: oc.input(WorkspaceScoped).output(Usage),
};
