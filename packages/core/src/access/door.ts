// The access door (spec 0005, the thin start of #9): the one place a signed in
// user and a workspace address become the engine's scope. Today the rule is
// "an active member may do everything"; #9 adds roles and field and record
// rules here, behind the same signature.
//
// The directory only finds the workspace's id; access comes from the tenant
// `members` row, read inside withWorkspace() under row level security. An
// unknown address, a workspace the user isn't in, a removed member and a
// deleted workspace are all refused the same way, so nothing leaks whether a
// workspace exists.
import { and, eq, isNull } from 'drizzle-orm';
import { schema, type Database, type IdentityStore } from '@crm/db';
import { isUuid } from '../engine/ids.ts';
import { refuse, type RefusalError } from '../engine/refusals.ts';
import type { EngineScope } from '../engine/scope.ts';

const { members, workspaces } = schema;

/** What the door needs: the tenant database, and the directory to find a workspace by its address. */
export interface DoorDeps {
  readonly db: Database;
  readonly identity: Pick<IdentityStore, 'findWorkspace'>;
}

/** Who is knocking (`auth.user.id`, from the session) and which workspace address they asked for. */
export interface DoorInput {
  readonly userId: string;
  readonly slug: string;
}

function notFound(): RefusalError {
  return refuse('NOT_FOUND', "That workspace doesn't exist, or you're not a member of it.");
}

/**
 * Turns a signed in user and a workspace slug into the engine's scope, or
 * refuses with NOT_FOUND. Only this function builds a member's scope; the
 * actor is the user's active member row in that workspace.
 */
export async function enterWorkspace(deps: DoorDeps, input: DoorInput): Promise<EngineScope> {
  if (!isUuid(input.userId)) throw notFound();
  const workspace = await deps.identity.findWorkspace(input.slug);
  if (workspace === undefined) throw notFound();
  const [member] = await deps.db.withWorkspace(workspace.id, (tx) =>
    tx
      .select({ id: members.id })
      .from(members)
      .innerJoin(workspaces, eq(workspaces.id, members.workspaceId))
      .where(and(eq(members.userId, input.userId), eq(members.status, 'active'), isNull(workspaces.deletedAt)))
      .limit(1),
  );
  if (member === undefined) throw notFound();
  return { db: deps.db, workspaceId: workspace.id, actor: { type: 'member', id: member.id } };
}
