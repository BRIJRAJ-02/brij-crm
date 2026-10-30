// A workspace's brand kit (spec 0060, AC-1 to AC-4, AC-23): Settings › Brand's read and save, and the logo's store
// path. Every member reads the kit; only `workspace.manage` (owners and admins) changes it, checked before anything
// is read or written. The row lives in `workspace_brands`, under the workspace's own row level security, so another
// workspace's kit is never in reach. The accent is checked here as in the contract and again by the column's check.
import { BRAND_HEX_PATTERN, BRAND_HEX_REFUSAL, type WorkspaceBrand } from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import { eq, sql } from 'drizzle-orm';
import { requirePermission } from '../access/check.ts';
import { checkScope, type EngineScope } from '../access/mint.ts';
import { can } from '../access/policy.ts';
import { inWorkspace } from '../access/run.ts';
import { inputInvalid, refuse } from '../engine/refusals.ts';

const { workspaceBrands } = schema;

/** The kit's row as the services read it. */
export interface BrandRow {
  readonly accent: string | null;
  readonly accentDark: string | null;
  readonly logoPath: string | null;
  readonly logoType: string | null;
  readonly logoVersion: string | null;
}

/** The workspace's kit row, or undefined before anyone saved one. Inside the caller's own workspace transaction. */
export async function brandRowOf(tx: WorkspaceTx, workspaceId: string): Promise<BrandRow | undefined> {
  const [row] = await tx
    .select({
      accent: workspaceBrands.accent,
      accentDark: workspaceBrands.accentDark,
      logoPath: workspaceBrands.logoPath,
      logoType: workspaceBrands.logoType,
      logoVersion: workspaceBrands.logoVersion,
    })
    .from(workspaceBrands)
    .where(eq(workspaceBrands.workspaceId, workspaceId));
  return row;
}

function toBrand(row: BrandRow | undefined, canEdit: boolean): WorkspaceBrand {
  return {
    ...(typeof row?.accent === 'string' ? { accent: row.accent } : {}),
    ...(typeof row?.accentDark === 'string' ? { accentDark: row.accentDark } : {}),
    ...(typeof row?.logoVersion === 'string' ? { logo: { version: row.logoVersion } } : {}),
    canEdit,
  };
}

/** The member a write is stamped with: only a signed in member saves a brand. */
function memberOf(scope: EngineScope): string {
  const { principal } = scope.access;
  if (principal.kind !== 'member') throw refuse('FORBIDDEN', 'Only a member of the workspace can change its brand.');
  return principal.memberId;
}

/** A checked hex or null, refused on `field` otherwise. */
function hexOrNull(value: string | null, field: string): string | null {
  if (value === null) return null;
  const lower = value.toLowerCase();
  if (!BRAND_HEX_PATTERN.test(lower)) throw inputInvalid(field, BRAND_HEX_REFUSAL);
  return lower;
}

/** The workspace's brand kit (AC-1): any member reads it; `canEdit` says whether this reader may change it. */
export async function getWorkspaceBrand(scope: EngineScope): Promise<WorkspaceBrand> {
  checkScope(scope);
  const row = await inWorkspace(scope, (tx) => brandRowOf(tx, scope.workspaceId));
  return toBrand(row, can(scope.access, 'workspace.manage'));
}

/**
 * Refuses FORBIDDEN unless the scope may change the brand kit (`workspace.manage`, owners and admins, AC-23). The
 * logo route asks this before it stores a single byte.
 */
export function requireBrandEditor(scope: EngineScope): void {
  requirePermission(scope, 'workspace.manage');
  memberOf(scope);
}

/**
 * Saves the accent pair, whole (AC-3): `null` clears one, so an empty field is the product's accent. A dark accent
 * needs a light one. The logo is kept as it is. Answers the kit as saved.
 */
export async function saveWorkspaceBrand(
  scope: EngineScope,
  input: { readonly accent: string | null; readonly accentDark: string | null },
): Promise<WorkspaceBrand> {
  requireBrandEditor(scope);
  const by = memberOf(scope);
  const accent = hexOrNull(input.accent, 'accent');
  const accentDark = hexOrNull(input.accentDark, 'accentDark');
  if (accentDark !== null && accent === null)
    throw inputInvalid('accentDark', 'Pick the main colour before a dark one.');
  const row = await inWorkspace(scope, async (tx) => {
    await tx
      .insert(workspaceBrands)
      .values({ workspaceId: scope.workspaceId, accent, accentDark, updatedBy: by })
      .onConflictDoUpdate({
        target: workspaceBrands.workspaceId,
        set: { accent, accentDark, updatedBy: by, updatedAt: sql`now()` },
      });
    return brandRowOf(tx, scope.workspaceId);
  });
  return toBrand(row, true);
}

/** The logo as the store keeps it: a path the server made, the type its bytes were checked as, and its version. */
export interface StoredLogo {
  readonly path: string;
  readonly type: 'image/png' | 'image/jpeg' | 'image/webp';
  readonly version: string;
}

/** The store path a workspace's logos live under; nothing outside it is ever written to the row. */
export function brandLogoFolder(workspaceId: string): string {
  return `logos/${workspaceId.toLowerCase()}/`;
}

/**
 * Makes `logo` the workspace's logo (AC-2), keeping the accent, and answers the path of the logo it replaced, which
 * the caller deletes from the store once this has committed. The path must be in this workspace's own folder.
 */
export async function saveBrandLogo(scope: EngineScope, logo: StoredLogo): Promise<{ readonly previous?: string }> {
  requireBrandEditor(scope);
  const by = memberOf(scope);
  if (!logo.path.startsWith(brandLogoFolder(scope.workspaceId)) || logo.path.includes('..')) {
    throw new Error('Refused a logo path the server did not make for this workspace.');
  }
  const previous = await inWorkspace(scope, async (tx) => {
    const before = await tx
      .select({ path: workspaceBrands.logoPath })
      .from(workspaceBrands)
      .where(eq(workspaceBrands.workspaceId, scope.workspaceId))
      .for('update');
    const values = { logoPath: logo.path, logoType: logo.type, logoVersion: logo.version, updatedBy: by };
    await tx
      .insert(workspaceBrands)
      .values({ workspaceId: scope.workspaceId, ...values })
      .onConflictDoUpdate({ target: workspaceBrands.workspaceId, set: { ...values, updatedAt: sql`now()` } });
    return before[0]?.path ?? undefined;
  });
  return previous === undefined || previous === logo.path ? {} : { previous };
}

/** Removes the workspace's logo (AC-2's Remove logo), answering the path to delete from the store, if there was one. */
export async function clearBrandLogo(scope: EngineScope): Promise<{ readonly previous?: string }> {
  requireBrandEditor(scope);
  const by = memberOf(scope);
  const previous = await inWorkspace(scope, async (tx) => {
    const cleared = await tx.execute<{ previous: string | null }>(
      sql`with before as (
            select logo_path from workspace_brands where workspace_id = ${scope.workspaceId}::uuid for update
          )
          update workspace_brands b
          set logo_path = null, logo_type = null, logo_version = null, updated_by = ${by}::uuid, updated_at = now()
          from before
          where b.workspace_id = ${scope.workspaceId}::uuid
          returning before.logo_path as previous`,
    );
    return cleared.rows[0]?.previous ?? undefined;
  });
  return previous === undefined ? {} : { previous };
}

/**
 * The logo a member sees in Settings › Brand (AC-1): its path and type, only at its current version, else none.
 * Any member: the kit is shown read only to everyone who can't change it.
 */
export async function readBrandLogo(
  scope: EngineScope,
  version: string,
): Promise<{ readonly logo?: { readonly path: string; readonly type: string } }> {
  checkScope(scope);
  const row = await inWorkspace(scope, (tx) => brandRowOf(tx, scope.workspaceId));
  const path = row?.logoPath;
  const type = row?.logoType;
  if (typeof path !== 'string' || typeof type !== 'string' || row?.logoVersion !== version) return {};
  return { logo: { path, type } };
}
