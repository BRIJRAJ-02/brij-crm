// The one gate every Hospitality entry point calls (spec 0065, AC-6504): every app but Events is on in every workspace,
// and `workspace_apps` stores only what differs from that, an owner's or admin's switch-off (`removed_at`) above all
// (`appsOn`). So a new workspace needs no write and an old one no backfill. Hiding a screen is never the only gate.
// Billing (#38, #42) plugs in here.
import { appsOn, HOSPITALITY_APPS, type HospitalityApp } from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import { eq, sql } from 'drizzle-orm';
import type { EngineScope } from '../access/mint.ts';
import { refuse } from '../engine/refusals.ts';
import { writeAudit } from '../members/audit.ts';

const { workspaceApps } = schema;

/** The refusal every app entry point gives while its app is switched off (AC-6504). */
export const APP_NOT_INSTALLED_MESSAGE = 'This app is off in this workspace.';

/** Whether a string names a Hospitality app. */
export const isApp = (value: string): value is HospitalityApp =>
  (HOSPITALITY_APPS as readonly string[]).includes(value);

/** The Hospitality apps on now (the sidebar's section, AC-6510). One query: the workspace's stored switches. */
export async function installedHospitalityApps(
  tx: WorkspaceTx,
  workspaceId: string,
): Promise<ReadonlySet<HospitalityApp>> {
  const rows = await tx
    .select({ app: workspaceApps.app, removed: sql<boolean>`${workspaceApps.removedAt} is not null` })
    .from(workspaceApps)
    .where(eq(workspaceApps.workspaceId, workspaceId));
  return appsOn(rows);
}

/** Whether `app` is on, in the caller's own transaction (AC-6504). */
export async function appInstalled(tx: WorkspaceTx, workspaceId: string, app: HospitalityApp): Promise<boolean> {
  return (await installedHospitalityApps(tx, workspaceId)).has(app);
}

/** Refuses `APP_NOT_INSTALLED` (403) unless `app` is on (AC-6504). Called after the access door. */
export async function requireApp(tx: WorkspaceTx, workspaceId: string, app: HospitalityApp): Promise<void> {
  if (!(await appInstalled(tx, workspaceId, app))) throw refuse('APP_NOT_INSTALLED', APP_NOT_INSTALLED_MESSAGE);
}

/**
 * Refuses `APP_NOT_INSTALLED` unless some Hospitality app is on: the gate of what the apps share (the
 * business, its places, areas and tables), which exist for whichever app uses them.
 */
export async function requireAnyApp(tx: WorkspaceTx, workspaceId: string): Promise<void> {
  if ((await installedHospitalityApps(tx, workspaceId)).size === 0) {
    throw refuse('APP_NOT_INSTALLED', 'Every business app is off. Turn one on in Settings, Apps.');
  }
}

/**
 * Refuses `CONFLICT` until the business card has made the business: its profile, its first place and Floor
 * staff come together, so nothing that hangs off a business gets ahead of it.
 */
export async function requireBusiness(tx: WorkspaceTx, workspaceId: string): Promise<void> {
  const [profile] = await tx
    .select({ workspaceId: schema.businessProfiles.workspaceId })
    .from(schema.businessProfiles)
    .where(eq(schema.businessProfiles.workspaceId, workspaceId));
  if (profile === undefined) throw refuse('CONFLICT', 'Set up your business first.');
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
