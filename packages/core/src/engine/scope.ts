// Who is acting, in which workspace (spec 0004). Every engine service takes a
// scope, which only the access door makes (spec 0009, `access/mint.ts`).
export type { EngineScope } from '../access/mint.ts';

/** Who did something: a member, an API key, an automation, or the system (whose id is null). */
export interface Actor {
  readonly type: 'member' | 'api_key' | 'automation' | 'system';
  readonly id: string | null;
}

/**
 * The system itself: seeding, jobs, migrations of data. Exported to the rest
 * of the code only from `@crm/core/system`, which lint keeps to the worker.
 */
export const SYSTEM_ACTOR: Actor = Object.freeze({ type: 'system', id: null });

/** An actor as the three columns every actor is stored in (`<prefix>_type`, `_id`, `_member_id`). */
export function actorRow(actor: Actor): { type: Actor['type']; id: string | null; memberId: string | null } {
  return { type: actor.type, id: actor.id, memberId: actor.type === 'member' ? actor.id : null };
}
