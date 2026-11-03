// The Hospitality apps (spec 0065, AC-6501 to AC-6506, AC-6511): which apps a workspace has, the one gate every app's
// entry point calls (`appInstalled`, `requireApp`), and installing and removing. An app shows only where Timefix
// opened early access (`workspaces.early_access`, the operator console's switch), and a workspace admin
// (`workspace.manage`) installs or removes it. Removing keeps every row: it sets `removed_at`, and installing again
// clears it. The first install of any Hospitality app takes the business card (profile and first place) in the same
// transaction, and seeds the "Floor staff" custom role (Run service only, read data access).
import {
  APP_NEEDS,
  appsNeeding,
  HOSPITALITY_APPS,
  type AppsView,
  type FirstBusiness,
  type HospitalityApp,
} from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import { and, count, eq, isNull, sql } from 'drizzle-orm';
import { requirePermission } from '../access/check.ts';
import { checkScope, type EngineScope } from '../access/mint.ts';
import { can } from '../access/policy.ts';
import { inWorkspace } from '../access/run.ts';
import { lockKey } from '../booking/locks.ts';
import { newId } from '../engine/ids.ts';
import { refuse } from '../engine/refusals.ts';
import { actorRow } from '../engine/scope.ts';
import { runWrite, type AfterWrite, type WriteContext } from '../engine/write.ts';
import { writeAudit } from '../members/audit.ts';
import { hasEarlyAccess, hospitalityMember, installedRows, isApp } from './gate.ts';
import { insertPlace } from './places.ts';

const { businessProfiles, members, workspaceApps, workspaceRoles, workspaces } = schema;

/**
 * Tells every active member's sidebar that the Hospitality section changed (AC-6510): one `nav` change event naming
 * them, which their sidebars already follow, so the section comes and goes within the usual moment.
 */
async function recordSidebars(context: WriteContext): Promise<void> {
  const { tx, scope } = context;
  const rows = await tx
    .select({ id: members.id })
    .from(members)
    .where(and(eq(members.workspaceId, scope.workspaceId), eq(members.status, 'active')));
  context.record({ nav: rows.map((row) => row.id) });
}

/** The app names in words, for refusals. */
const APP_NAMES: Readonly<Record<HospitalityApp, string>> = {
  menu: 'Menu',
  menu_qr: 'Menu QR',
  table_seating: 'Table seating',
  appointments: 'Appointments',
  events: 'Events',
};

/** The Apps page as this reader sees it, inside the caller's transaction. */
async function viewOf(tx: WorkspaceTx, scope: EngineScope): Promise<AppsView> {
  const canManage = can(scope.access, 'workspace.manage');
  if (!(await hasEarlyAccess(tx, scope.workspaceId))) {
    return { available: false, canManage, hasBusiness: false, apps: [] };
  }
  const rows = await tx
    .select({ app: workspaceApps.app, installedAt: workspaceApps.installedAt, removedAt: workspaceApps.removedAt })
    .from(workspaceApps)
    .where(eq(workspaceApps.workspaceId, scope.workspaceId));
  const [profile] = await tx
    .select({ name: businessProfiles.name })
    .from(businessProfiles)
    .where(eq(businessProfiles.workspaceId, scope.workspaceId));
  return {
    available: true,
    canManage,
    hasBusiness: profile !== undefined,
    apps: HOSPITALITY_APPS.map((app) => {
      const row = rows.find((each) => each.app === app && each.removedAt === null);
      return row === undefined
        ? { app, installed: false }
        : { app, installed: true, installedAt: new Date(row.installedAt).toISOString() };
    }),
  };
}

/**
 * Settings › Apps (AC-6501): any member reads it; without early access it answers nothing about the apps.
 * `canManage` says whether this reader may install and remove.
 */
export async function listApps(scope: EngineScope): Promise<AppsView> {
  checkScope(scope);
  return inWorkspace(scope, (tx) => viewOf(tx, scope));
}

/** The "Floor staff" role's words (AC-6511). */
const FLOOR_STAFF = {
  name: 'Floor staff',
  description: 'Runs service: today’s book, seating, walk ins and sold out dishes.',
} as const;

/**
 * Seeds the "Floor staff" custom role (AC-6511): based on Member, holding only Run service, with read data access
 * (custom roles can't yet hold no data access, J10). Skipped when the workspace already has a role of that name or
 * its 20 custom roles, under the roles lock every role write takes.
 */
async function seedFloorStaff(tx: WorkspaceTx, scope: EngineScope): Promise<void> {
  await lockKey(tx, `roles:${scope.workspaceId}`);
  const [counted] = await tx
    .select({ n: count() })
    .from(workspaceRoles)
    .where(eq(workspaceRoles.workspaceId, scope.workspaceId));
  const position = counted?.n ?? 0;
  if (position >= 20) return;
  const by = actorRow(scope.actor);
  const id = newId();
  const made = await tx
    .insert(workspaceRoles)
    .values({
      workspaceId: scope.workspaceId,
      id,
      name: FLOOR_STAFF.name,
      description: FLOOR_STAFF.description,
      permissions: ['hospitality.service'],
      position,
      defaultObjectLevel: 'read',
      startedFrom: 'member',
      createdByType: by.type,
      createdById: by.id,
      createdByMemberId: by.memberId,
      updatedByType: by.type,
      updatedById: by.id,
      updatedByMemberId: by.memberId,
    })
    .onConflictDoNothing()
    .returning({ id: workspaceRoles.id });
  if (made.length === 0) return;
  await writeAudit(tx, scope.workspaceId, scope.actor, {
    action: 'role.created',
    targetType: 'role',
    targetId: id,
    after: { name: FLOOR_STAFF.name, permissions: ['hospitality.service'], dataAccess: 'read', startedFrom: 'member' },
  });
}

/** Audits a change to the installed apps, as a workspace change (`apps`, before and after). */
function auditApps(
  tx: WorkspaceTx,
  scope: EngineScope,
  before: ReadonlySet<HospitalityApp>,
  after: ReadonlySet<HospitalityApp>,
): Promise<void> {
  return writeAudit(tx, scope.workspaceId, scope.actor, {
    action: 'workspace.updated',
    targetType: 'workspace',
    targetId: scope.workspaceId,
    before: { apps: [...before].sort() },
    after: { apps: [...after].sort() },
  });
}

/**
 * Installs an app (AC-6503, AC-6505, AC-6506): `workspace.manage` only; instant. An app that needs another (Menu QR
 * needs Menu) is refused `APP_NEEDED` unless `withNeeded` installs both in this one step. The first time any
 * Hospitality app is installed, `business` (the card) is required (`BUSINESS_NEEDED` without it) and made in the same
 * transaction with the first place, and the "Floor staff" role is seeded. Installing again clears `removed_at`, so
 * everything comes back as it was. Answers the Apps page.
 */
export async function installApp(
  scope: EngineScope,
  input: { readonly app: HospitalityApp; readonly withNeeded?: boolean; readonly business?: FirstBusiness },
  hooks: readonly AfterWrite[] = [],
): Promise<AppsView> {
  requirePermission(scope, 'workspace.manage');
  const by = hospitalityMember(scope);
  if (!isApp(input.app)) throw refuse('NOT_FOUND', 'There is no such app.');
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      await lockKey(tx, `apps:${scope.workspaceId}`);
      if (!(await hasEarlyAccess(tx, scope.workspaceId))) {
        throw refuse('NOT_FOUND', 'The Hospitality apps aren’t open to this workspace yet.');
      }
      const before = await installedRows(tx, scope.workspaceId);
      const needed = APP_NEEDS[input.app].filter((app) => !before.has(app));
      if (needed.length > 0 && input.withNeeded !== true) {
        throw refuse(
          'APP_NEEDED',
          `${APP_NAMES[input.app]} needs ${needed.map((app) => APP_NAMES[app]).join(' and ')}. Install both?`,
        );
      }
      const [profile] = await tx
        .select({ name: businessProfiles.name })
        .from(businessProfiles)
        .where(eq(businessProfiles.workspaceId, scope.workspaceId));
      if (profile === undefined) {
        if (input.business === undefined) {
          throw refuse('BUSINESS_NEEDED', 'Tell us about the business first: its name, kind and first place.');
        }
        await tx.insert(businessProfiles).values({
          workspaceId: scope.workspaceId,
          name: input.business.name,
          kind: input.business.kind,
          createdByMemberId: by,
          updatedByMemberId: by,
        });
        await insertPlace(tx, scope, newId(), { name: input.business.name, ...input.business.place }, by);
        // The card's currency becomes the workspace's only while it has none: an existing default is never moved.
        const changed = await tx
          .update(workspaces)
          .set({ currency: input.business.currency })
          .where(and(eq(workspaces.id, scope.workspaceId), isNull(workspaces.currency)))
          .returning({ id: workspaces.id });
        if (changed.length > 0) {
          await writeAudit(tx, scope.workspaceId, scope.actor, {
            action: 'workspace.updated',
            targetType: 'workspace',
            targetId: scope.workspaceId,
            before: { currency: null },
            after: { currency: input.business.currency },
          });
        }
      }
      const [ever] = await tx
        .select({ n: count() })
        .from(workspaceApps)
        .where(eq(workspaceApps.workspaceId, scope.workspaceId));
      if ((ever?.n ?? 0) === 0) await seedFloorStaff(tx, scope);
      const adding = [...needed, input.app].filter((app) => !before.has(app));
      if (adding.length > 0) {
        await tx
          .insert(workspaceApps)
          .values(adding.map((app) => ({ workspaceId: scope.workspaceId, app, installedByMemberId: by })))
          .onConflictDoUpdate({
            target: [workspaceApps.workspaceId, workspaceApps.app],
            set: { removedAt: null, installedAt: sql`now()`, installedByMemberId: by },
          });
        await auditApps(tx, scope, before, new Set([...before, ...adding]));
        await recordSidebars(context);
      }
      return viewOf(tx, scope);
    },
    hooks,
  );
  return result;
}

/**
 * Removes an app (AC-6503, AC-6505): `workspace.manage` only. Its screens and public pages stop at once, every row is
 * kept. Removing an app another installed app needs (Menu, with Menu QR) is refused `APP_NEEDED` unless
 * `withDependents` removes both. Answers the Apps page.
 */
export async function removeApp(
  scope: EngineScope,
  input: { readonly app: HospitalityApp; readonly withDependents?: boolean },
  hooks: readonly AfterWrite[] = [],
): Promise<AppsView> {
  requirePermission(scope, 'workspace.manage');
  hospitalityMember(scope);
  if (!isApp(input.app)) throw refuse('NOT_FOUND', 'There is no such app.');
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      await lockKey(tx, `apps:${scope.workspaceId}`);
      const before = await installedRows(tx, scope.workspaceId);
      if (!before.has(input.app)) return viewOf(tx, scope);
      const dependents = appsNeeding(input.app).filter((app) => before.has(app));
      if (dependents.length > 0 && input.withDependents !== true) {
        throw refuse(
          'APP_NEEDED',
          `${dependents.map((app) => APP_NAMES[app]).join(' and ')} needs ${APP_NAMES[input.app]}. Remove both?`,
        );
      }
      const removing = [input.app, ...dependents];
      for (const app of removing) {
        await tx
          .update(workspaceApps)
          .set({ removedAt: sql`now()` })
          .where(and(eq(workspaceApps.workspaceId, scope.workspaceId), eq(workspaceApps.app, app)));
      }
      await auditApps(tx, scope, before, new Set([...before].filter((app) => !removing.includes(app))));
      await recordSidebars(context);
      return viewOf(tx, scope);
    },
    hooks,
  );
  return result;
}
