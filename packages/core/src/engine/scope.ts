// Who is acting, in which workspace (spec 0004). Every engine service takes a
// scope. From #9 the access door produces it; until then tests and the seed
// scripts build it directly, and no endpoint exists yet.
import type { Database } from '@crm/db';

/** Who did something: a member, an API key, an automation, or the system (whose id is null). */
export interface Actor {
  readonly type: 'member' | 'api_key' | 'automation' | 'system';
  readonly id: string | null;
}

/** The workspace and actor a service acts for, and the database it acts on. */
export interface EngineScope {
  readonly db: Database;
  readonly workspaceId: string;
  readonly actor: Actor;
}

/** The system itself: seeding, jobs, migrations of data. */
export const SYSTEM_ACTOR: Actor = { type: 'system', id: null };

/** An actor as the three columns every actor is stored in (`<prefix>_type`, `_id`, `_member_id`). */
export function actorRow(actor: Actor): { type: Actor['type']; id: string | null; memberId: string | null } {
  return { type: actor.type, id: actor.id, memberId: actor.type === 'member' ? actor.id : null };
}
