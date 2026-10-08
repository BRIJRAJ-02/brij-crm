// A workspace's members as its screens show them (spec 0005): the Owner
// column turns a member id into a name with this list. Read only, through the
// scope the access door made.
import { and, asc, eq, sql } from 'drizzle-orm';
import type { MemberSummary } from '@crm/contracts';
import { schema } from '@crm/db';
import type { EngineScope } from '../engine/scope.ts';
import { inWorkspace } from '../access/run.ts';

const { members } = schema;

/** The workspace's active members (id, name, email), by name. Removed members are left out. */
export async function listMembers(scope: EngineScope): Promise<MemberSummary[]> {
  return inWorkspace(scope, (tx) =>
    tx
      .select({ id: members.id, name: members.name, email: members.email })
      .from(members)
      // Row level security keeps the read to this workspace; the filter says so too (house style).
      .where(and(eq(members.workspaceId, scope.workspaceId), eq(members.status, 'active')))
      .orderBy(asc(sql`lower(${members.name})`), asc(members.id)),
  );
}
