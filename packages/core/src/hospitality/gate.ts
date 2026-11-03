// The one gate every Hospitality entry point calls (spec 0065, AC-6504): an app counts as installed only while its
// `workspace_apps` row has no `removed_at` and Timefix's early access is still open for the workspace. Hiding a screen
// is never the only gate. Billing (#38, #42) plugs in here.
import { HOSPITALITY_APPS, type HospitalityApp } from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { EngineScope } from '../access/mint.ts';
import { refuse } from '../engine/refusals.ts';
import { writeAudit } from '../members/audit.ts';

const { workspaceApps, workspaces } = schema;

/** The refusal every app entry point gives while its app isn't installed (AC-6504). */
export const APP_NOT_INSTALLED_MESSAGE = 'This app isn’t installed in this workspace.';

/** Whether a string names a Hospitality app. */
export const isApp = (value: string): value is HospitalityApp =>
  (HOSPITALITY_APPS as readonly string[]).includes(value);

/** Whether the workspace has early access to the Hospitality apps (AC-6501). */
export async function hasEarlyAccess(tx: WorkspaceTx, workspaceId: string): Promise<boolean> {
  const [row] = await tx
    .select({ on: sql<boolean>`'hospitality' = any(${workspaces.earlyAccess})` })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId));
  return row?.on === true;
}

/** The apps whose rows say installed (not removed), early access aside. */
export async function installedRows(tx: WorkspaceTx, workspaceId: string): Promise<ReadonlySet<HospitalityApp>> {
  const rows = await tx
    .select({ app: workspaceApps.app })
    .from(workspaceApps)
    .where(and(eq(workspaceApps.workspaceId, workspaceId), isNull(workspaceApps.removedAt)));
  return new Set(rows.map((row) => row.app).filter(isApp));
}

/**
 * The Hospitality apps installed now (the sidebar's section, AC-6510); none without early access. One query: the
 * workspace's early access joined to its live app rows.
 */
export async function installedHospitalityApps(
  tx: WorkspaceTx,
  workspaceId: string,
): Promise<ReadonlySet<HospitalityApp>> {
  const rows = await tx
    .select({ app: workspaceApps.app })
    .from(workspaceApps)
    .innerJoin(workspaces, eq(workspaces.id, workspaceApps.workspaceId))
    .where(
      and(
        eq(workspaceApps.workspaceId, workspaceId),
        isNull(workspaceApps.removedAt),
        sql`'hospitality' = any(${workspaces.earlyAccess})`,
      ),
    );
  return new Set(rows.map((row) => row.app).filter(isApp));
}

/** Whether `app` is installed and its early access still open, in the caller's own transaction (AC-6504). */
export async function appInstalled(tx: WorkspaceTx, workspaceId: string, app: HospitalityApp): Promise<boolean> {
  return (await installedHospitalityApps(tx, workspaceId)).has(app);
}

/** Refuses `APP_NOT_INSTALLED` (403) unless `app` is installed (AC-6504). Called after the access door. */
export async function requireApp(tx: WorkspaceTx, workspaceId: string, app: HospitalityApp): Promise<void> {
  if (!(await appInstalled(tx, workspaceId, app))) throw refuse('APP_NOT_INSTALLED', APP_NOT_INSTALLED_MESSAGE);
}

/**
 * Refuses `APP_NOT_INSTALLED` unless some Hospitality app is installed: the gate of what the apps share (the
 * business, its places, areas and tables), which exist for whichever app uses them.
 */
export async function requireAnyApp(tx: WorkspaceTx, workspaceId: string): Promise<void> {
  if ((await installedHospitalityApps(tx, workspaceId)).size === 0) {
    throw refuse('APP_NOT_INSTALLED', 'Install a Hospitality app first, in Settings, Apps.');
  }
}

/** The member a write is stamped with: only a signed in member installs, removes or sets up. */
export function hospitalityMember(scope: EngineScope): string {
  const { principal } = scope.access;
  if (principal.kind !== 'member') throw refuse('FORBIDDEN', 'Only a member of the workspace can set up its apps.');
  return principal.memberId;
}

/**
 * Audits one setup change (the business, a place, an area or a table) as a workspace change, naming what changed and
 * its ids, so History says who changed the hours or deleted a table. No values a guest typed are kept.
 */
export function auditSetup(
  tx: WorkspaceTx,
  scope: EngineScope,
  what: string,
  ids: Readonly<Record<string, string>> = {},
): Promise<void> {
  return writeAudit(tx, scope.workspaceId, scope.actor, {
    action: 'workspace.updated',
    targetType: 'workspace',
    targetId: scope.workspaceId,
    after: { hospitality: what, ...ids },
  });
}
