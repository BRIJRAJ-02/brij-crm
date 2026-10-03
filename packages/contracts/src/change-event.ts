// The change event (spec 0005, change events): what the relay publishes to a
// workspace's channel, one per outbox row. Ids only, never values: a browser
// fetches the named records again through the API, so the access door decides
// what each person sees.
import * as z from 'zod';

/**
 * One change, numbered per workspace with no gaps (`seq`). `records`: these
 * records of the object changed (refetch the ones you hold), or, when
 * `coarse`, too many to list (refetch everything you hold of the object).
 * `definitions`: the object's attributes changed (refetch them). `mutationId`
 * is the browser's own id for the write, so it can skip its own change.
 */
export const ChangeEvent = z.object({
  seq: z.number().int().positive(),
  kind: z.enum(['records', 'definitions']),
  objectId: z.uuid(),
  recordIds: z.array(z.uuid()),
  attributeIds: z.array(z.uuid()),
  mutationId: z.uuid().optional(),
  coarse: z.literal(true).optional(),
});
/** One change event on a workspace's channel. */
export type ChangeEvent = z.infer<typeof ChangeEvent>;

/** The channel a workspace's change events go to: `workspace:<id>` (Centrifugo's `workspace` namespace). */
export function workspaceChannel(workspaceId: string): string {
  return `workspace:${workspaceId}`;
}
