// Menu QR per table (spec 0065, H2). Every table (a resource of kind `table`) carries its own code, 22 random
// base64url characters (`resources.table_code`, migration 0187), and its printed QR opens `/m/<menu key>?t=<code>`.
// The QR codes screen lists a place's live tables with their codes and scan counts, and a code can be replaced,
// which stops the old print opening the table. `hospitality.manage` only, checked before any input is read, and only
// while Menu QR is installed.
//
// The guest side: the menu door (`crm_menu_by_key`) names the workspace and place first, then `scanTable` reads the
// code inside that workspace under its row level security, so a code can only ever name a table of the key's own
// place. A scan is counted as a `qr` page visit of that table (spec 0067's daily visitor hash, nothing else kept).
import { tableDisplayName, TABLE_CODE_PATTERN, type PlaceQrCodes, type PublicMenuTable } from '@crm/contracts';
import { schema, type Database, type WorkspaceTx } from '@crm/db';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { requirePermission } from '../access/check.ts';
import type { EngineScope } from '../access/mint.ts';
import { inWorkspace } from '../access/run.ts';
import { lockKey } from '../booking/locks.ts';
import { checkId } from '../engine/ids.ts';
import { refuse } from '../engine/refusals.ts';
import { countPageVisit } from '../insights/visits.ts';
import { auditSetup, appInstalled, hospitalityMember, requireApp } from './gate.ts';
import { PLACE_NOT_FOUND } from './places.ts';
import type { MenuEntry } from './public-menu.ts';

const { areas, menuDrafts, menuVersions, places, resources } = schema;

const TABLE_NOT_FOUND = 'That table doesn’t exist.';

/** How many days of scans the screen sums. */
export const QR_SCAN_DAYS = 30;

/** One place's QR codes, read in the caller's transaction. */
async function readQrCodes(tx: WorkspaceTx, workspaceId: string, placeId: string): Promise<PlaceQrCodes> {
  const [place] = await tx
    .select({ id: places.id, name: places.name, menuKey: places.menuKey, propertyId: places.propertyId })
    .from(places)
    .where(and(eq(places.workspaceId, workspaceId), eq(places.id, placeId)));
  if (place === undefined) throw refuse('NOT_FOUND', PLACE_NOT_FOUND);
  const [published] = await tx
    .select({ version: menuVersions.version })
    .from(menuVersions)
    .where(and(eq(menuVersions.workspaceId, workspaceId), eq(menuVersions.placeId, placeId)))
    .orderBy(desc(menuVersions.version))
    .limit(1);
  // Live or Hidden is the place's business's (spec 0065 H7).
  const [draft] = await tx
    .select({ hidden: menuDrafts.hidden })
    .from(menuDrafts)
    .where(and(eq(menuDrafts.workspaceId, workspaceId), eq(menuDrafts.propertyId, place.propertyId)));
  const rows = await tx
    .select({ id: resources.id, label: resources.label, code: resources.tableCode, areaName: areas.name })
    .from(resources)
    .leftJoin(areas, and(eq(areas.workspaceId, resources.workspaceId), eq(areas.id, resources.areaId)))
    .where(
      and(
        eq(resources.workspaceId, workspaceId),
        eq(resources.placeId, placeId),
        eq(resources.kind, 'table'),
        isNull(resources.archivedAt),
      ),
    )
    .orderBy(asc(resources.position), asc(resources.id));
  // A scan is one visitor's day on one code (spec 0067's `qr` page visits); summed per table, one indexed read.
  const scans = await tx.execute<{ page_id: string; scans: number }>(sql`
    select page_id::text as page_id, count(*)::int as scans
    from page_visits
    where workspace_id = ${workspaceId} and page_kind = 'qr'
      and day > (now() at time zone 'UTC')::date - ${QR_SCAN_DAYS}::int
    group by page_id
  `);
  const scanned = new Map(scans.rows.map((row) => [row.page_id, row.scans]));
  return {
    placeId: place.id,
    placeName: place.name,
    menuKey: place.menuKey,
    menuState: published === undefined ? 'unpublished' : draft?.hidden === true ? 'hidden' : 'live',
    tables: rows.map((row) => ({
      id: row.id,
      label: row.label,
      ...(row.areaName === null ? {} : { areaName: row.areaName }),
      code: row.code,
      scans: scanned.get(row.id) ?? 0,
    })),
  };
}

/** One place's table QR codes (H2): `hospitality.manage`, and only while Menu QR is installed. */
export async function listQrCodes(scope: EngineScope, input: { readonly placeId: string }): Promise<PlaceQrCodes> {
  requirePermission(scope, 'hospitality.manage');
  const id = checkId(input.placeId, PLACE_NOT_FOUND);
  return inWorkspace(scope, async (tx) => {
    await requireApp(tx, scope.workspaceId, 'menu_qr');
    return readQrCodes(tx, scope.workspaceId, id);
  });
}

/**
 * Gives one table a new code (H2): a fresh 122 bit default, so the old print stops opening the table (the screen asks
 * first). Under the place's lock, audited, and answered with the place's codes after it.
 */
export async function regenerateTableCode(
  scope: EngineScope,
  input: { readonly placeId: string; readonly resourceId: string },
): Promise<PlaceQrCodes> {
  requirePermission(scope, 'hospitality.manage');
  hospitalityMember(scope);
  const placeId = checkId(input.placeId, PLACE_NOT_FOUND);
  const resourceId = checkId(input.resourceId, TABLE_NOT_FOUND);
  return inWorkspace(scope, async (tx) => {
    await requireApp(tx, scope.workspaceId, 'menu_qr');
    await lockKey(tx, `place:${scope.workspaceId}:${placeId}`);
    const changed = await tx
      .update(resources)
      .set({ tableCode: sql`default`, updatedAt: sql`now()`, updatedByMemberId: hospitalityMember(scope) })
      .where(
        and(
          eq(resources.workspaceId, scope.workspaceId),
          eq(resources.placeId, placeId),
          eq(resources.id, resourceId),
          eq(resources.kind, 'table'),
          isNull(resources.archivedAt),
        ),
      )
      .returning({ id: resources.id });
    if (changed.length === 0) throw refuse('NOT_FOUND', TABLE_NOT_FOUND);
    await auditSetup(tx, scope, 'qr.code.regenerated', { placeId, resourceId });
    return readQrCodes(tx, scope.workspaceId, placeId);
  });
}

/**
 * A guest's scan of a table's QR (H2): the table `code` names among the live tables of the menu key's own place, or
 * undefined (a malformed code, another place's, an archived table, Menu QR removed: the same nothing). When `visitor`
 * is given (spec 0047's daily hash; the caller leaves out machines), the scan is counted as that table's `qr` visit.
 * One transaction on the entry's workspace, under its row level security.
 */
export async function scanTable(
  deps: { readonly db: Database },
  entry: MenuEntry,
  code: string,
  visitor?: string,
): Promise<PublicMenuTable | undefined> {
  if (!TABLE_CODE_PATTERN.test(code)) return undefined;
  return deps.db.withWorkspace(entry.workspaceId, async (tx) => {
    if (!(await appInstalled(tx, entry.workspaceId, 'menu_qr'))) return undefined;
    const [table] = await tx
      .select({ id: resources.id, label: resources.label })
      .from(resources)
      .where(
        and(
          eq(resources.workspaceId, entry.workspaceId),
          eq(resources.placeId, entry.placeId),
          eq(resources.tableCode, code),
          eq(resources.kind, 'table'),
          isNull(resources.archivedAt),
        ),
      );
    if (table === undefined) return undefined;
    if (visitor !== undefined) {
      await countPageVisit(tx, {
        workspaceId: entry.workspaceId,
        kind: 'qr',
        pageId: table.id,
        visitor,
        step: 'view',
      });
    }
    return { label: table.label, name: tableDisplayName(table.label) };
  });
}
