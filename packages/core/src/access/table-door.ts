// Table seating's public door (spec 0066 B7 lite; spec 0065 AC-6550, AC-6557): a reservation page's key (the
// place's public key) names a place through `crm_table_place_by_key` (ids only, only while the workspace is live with
// business apps), then the guest acts as that place's narrow `booking` actor: write on People and Companies of that
// one workspace (the guest's Person is matched or made) and no permission at all. Whether the page takes reservations
// (`installed`) is the services' question. Exported only from `@crm/core/public`.
import { and, inArray, isNull, sql } from 'drizzle-orm';
import { schema, type Database } from '@crm/db';
import { refuse } from '../engine/refusals.ts';
import { mintScope, type EngineScope } from './mint.ts';
import { bookingAccess } from './policy.ts';

const { objects } = schema;

/** The nil uuid: a workspace no row has, for the lookup made before the workspace is known. */
const NO_WORKSPACE = '00000000-0000-0000-0000-000000000000';

/** A place's public key: 16 URL safe characters. */
export const TABLE_KEY_PATTERN = /^[A-Za-z0-9_-]{16}$/;

/** What the table door answers: the guest's scope at the place, and whether Table seating is installed now. */
export interface TableEntry {
  readonly scope: EngineScope;
  readonly placeId: string;
  readonly key: string;
  /** False once Table seating is removed: a reservation already made still opens, new ones refuse. */
  readonly installed: boolean;
}

/**
 * The reservation page's entry: a malformed key never reaches the database, and an unknown key, a deleted workspace,
 * one without business apps, or one without both standard objects is NOT_FOUND, all one answer.
 */
export async function enterTablePage(deps: { readonly db: Database }, key: string): Promise<TableEntry> {
  const missing = () => refuse('NOT_FOUND', 'This page is no longer available.');
  if (!TABLE_KEY_PATTERN.test(key)) throw missing();
  const found = await deps.db.withWorkspace(NO_WORKSPACE, (tx) =>
    tx.execute<{ workspace_id: string; place_id: string; installed: boolean }>(
      sql`select workspace_id::text, place_id::text, installed from crm_table_place_by_key(${key})`,
    ),
  );
  const [row] = found.rows;
  if (row === undefined) throw missing();
  const standard = await deps.db.withWorkspace(row.workspace_id, (tx) =>
    tx
      .select({ id: objects.id, key: objects.standardKey })
      .from(objects)
      .where(and(inArray(objects.standardKey, ['people', 'companies']), isNull(objects.archivedAt))),
  );
  const people = standard.find((object) => object.key === 'people')?.id;
  const companies = standard.find((object) => object.key === 'companies')?.id;
  if (people === undefined || companies === undefined) throw missing();
  const scope = mintScope({
    db: deps.db,
    workspaceId: row.workspace_id,
    actor: { type: 'booking', id: row.place_id },
    access: bookingAccess(row.place_id, [people, companies]),
  });
  return { scope, placeId: row.place_id, key, installed: row.installed };
}
