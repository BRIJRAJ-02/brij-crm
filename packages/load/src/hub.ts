// The `hub` scenario's setup (spec 0011, AC-206): the hub as the users will
// write it, and the hub's people each user moves. Read once before the warm
// up through the owner login, as setup may (the option ids are read the same
// way); every action the users then take goes through the API.
import { sql } from 'drizzle-orm';
import type { LoadManifest } from '@crm/core/load-files';
import { loadRefusal } from '@crm/core/load-local';
import type { Database } from '@crm/db';
import type { HubModel } from './user.ts';

/** The hub, and each user's own people from its Team (user index to ids), none shared between users. */
export interface HubSetup {
  readonly model: HubModel;
  readonly people: readonly (readonly string[])[];
}

/** Deals `ids` out to `users` users in turn, `perUser` each at most: user `u` takes ids `u`, `u + users`, and so on. */
export function dealPeople(ids: readonly string[], users: number, perUser: number): readonly (readonly string[])[] {
  return Array.from({ length: users }, (_, user) => ids.filter((_, index) => index % users === user).slice(0, perUser));
}

/**
 * The hub's model from the manifest, and `users × perUser` live people from
 * its Team now (spread by a hash of the id), dealt out so no two users move
 * the same person. Refuses (exit 3) a manifest without the attributes a move
 * writes, or a hub with no Team left to move (naming `pnpm load:reset`).
 */
export async function hubSetup(
  db: Database,
  manifest: LoadManifest,
  users: number,
  perUser: number,
): Promise<HubSetup> {
  const companiesObjectId = manifest.objects.companies;
  const companyAttributeId = manifest.attributes['people.company'];
  const nameAttributeId = manifest.attributes['companies.name'];
  if (companiesObjectId === undefined || companyAttributeId === undefined || nameAttributeId === undefined) {
    throw loadRefusal('The manifest has no Companies, People Company or Company name. Seed again: `pnpm load:seed`.');
  }
  const ids = await db.withWorkspace(manifest.workspaceId, async (tx) => {
    const result = await tx.execute<{ id: string }>(sql`
      select l.from_record_id::text as id
      from attributes a
      join record_links l on l.workspace_id = a.workspace_id and l.relationship_id = a.relationship_id
      join records r on r.workspace_id = l.workspace_id and r.id = l.from_record_id and r.deleted_at is null
      where a.workspace_id = ${manifest.workspaceId} and a.id = ${manifest.hubTeamAttributeId}
        and l.to_record_id = ${manifest.hubCompanyId} and l.active_until is null
      order by hashtext(l.from_record_id::text), l.from_record_id
      limit ${users * perUser}
    `);
    return result.rows.map((row) => row.id);
  });
  if (ids.length < users) {
    throw loadRefusal(
      `The hub's Team holds ${String(ids.length)} live people, fewer than the run's ${String(users)} users. ` +
        'Put it back first: `pnpm load:reset`.',
    );
  }
  const elsewhere = (manifest.samples.companies ?? []).filter((id) => id !== manifest.hubCompanyId);
  if (elsewhere.length === 0) throw loadRefusal('The manifest has no other companies to move people to.');
  return {
    model: {
      companyId: manifest.hubCompanyId,
      companiesObjectId,
      companyAttributeId,
      nameAttributeId,
      elsewhere,
    },
    people: dealPeople(ids, users, perUser),
  };
}
