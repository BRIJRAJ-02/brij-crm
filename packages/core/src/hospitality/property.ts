// The one place a workspace's property is resolved (spec 0065 H7, slice 1): a workspace has one property until slice 2
// lets it have more, and every hospitality read and write that needs "the property" gets it here. A property nobody has
// set up has no name, which is what "no business yet" reads as (AC-6512).
import { schema, type WorkspaceTx } from '@crm/db';
import { asc, eq, sql, type SQL } from 'drizzle-orm';

const { properties } = schema;

/**
 * The id of the property this workspace works from, as part of a statement: its first, by position. A subquery, so
 * filtering or stamping a row by it costs no round trip of its own.
 */
export const currentPropertyRef = (workspaceId: string): SQL =>
  sql`(select p.id from properties p where p.workspace_id = ${workspaceId}::uuid order by p.position, p.id limit 1)`;

/** The property this workspace works from, for the reads that show its facts. */
export interface CurrentProperty {
  readonly id: string;
  readonly name: string | null;
  readonly kind: string | null;
  readonly description: string | null;
  readonly phone: string | null;
  readonly email: string | null;
  readonly website: string | null;
  readonly links: unknown;
  readonly look: unknown;
  readonly currency: string | null;
}

/**
 * Reads the property this workspace works from. Every workspace has one (a trigger on `workspaces` makes it), so none
 * here is a broken database and throws rather than reading as "no business".
 */
export async function currentProperty(tx: WorkspaceTx, workspaceId: string): Promise<CurrentProperty> {
  const [row] = await tx
    .select({
      id: properties.id,
      name: properties.name,
      kind: properties.kind,
      description: properties.description,
      phone: properties.phone,
      email: properties.email,
      website: properties.website,
      links: properties.links,
      look: properties.look,
      currency: properties.currency,
    })
    .from(properties)
    .where(eq(properties.workspaceId, workspaceId))
    .orderBy(asc(properties.position), asc(properties.id))
    .limit(1);
  if (row === undefined) throw new Error('The workspace has no property.');
  return row;
}

/**
 * Sets the property's currency when the workspace's changes: Settings > Workspace is still the only place that sets it,
 * so prices keep following it as they did. Slice 2 gives the property its own setting and ends this.
 */
export async function followWorkspaceCurrency(
  tx: WorkspaceTx,
  workspaceId: string,
  currency: string | null,
): Promise<void> {
  await tx
    .update(properties)
    .set({ currency })
    .where(
      sql`${properties.workspaceId} = ${workspaceId}::uuid and ${properties.id} = ${currentPropertyRef(workspaceId)}`,
    );
}
