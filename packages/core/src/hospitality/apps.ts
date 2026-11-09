// The Hospitality apps (spec 0065, AC-6501 to AC-6506, AC-6511): which apps a workspace has on, and switching them.
// Every app but Events starts on (`appsOn`), and a workspace admin (`workspace.manage`) switches one off or back on.
// Off keeps every row: it sets `removed_at`, and on again clears it. The business card (the property and its first place) is
// taken whenever it is sent and the business isn't set up yet, in the same transaction, and setting it up seeds the
// "Floor staff" custom role (Run service only, read data access).
import {
  APP_NEEDS,
  APPS_ON_BY_DEFAULT,
  APPOINTMENT_HOURS,
  APPOINTMENT_KINDS,
  appsNeeding,
  HOSPITALITY_APPS,
  RESTAURANT_HOURS,
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
import { syncBusinessListing } from './business-page.ts';
import { auditSetup, hospitalityMember, installedHospitalityApps, isApp } from './gate.ts';
import { insertPlace } from './places.ts';
import { currentProperty, currentPropertyRef } from './property.ts';

const { members, properties, workspaceApps, workspaceRoles, workspaces } = schema;

/**
 * Tells every active member's sidebar that the Hospitality section changed (AC-6510): one `nav` change event naming
 * them, which their sidebars already follow, so the section comes and goes within the usual moment.
 */
export async function recordSidebars(context: WriteContext): Promise<void> {
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
  const on = await installedHospitalityApps(tx, scope.workspaceId);
  const rows = await tx
    .select({ app: workspaceApps.app, installedAt: workspaceApps.installedAt })
    .from(workspaceApps)
    .where(and(eq(workspaceApps.workspaceId, scope.workspaceId), isNull(workspaceApps.removedAt)));
  const property = await currentProperty(tx, scope.workspaceId);
  return {
    canManage,
    hasBusiness: property.name !== null,
    apps: HOSPITALITY_APPS.map((app) => {
      if (!on.has(app)) return { app, installed: false };
      // On by default has no row, so no date.
      const row = rows.find((each) => each.app === app);
      return row === undefined
        ? { app, installed: true }
        : { app, installed: true, installedAt: new Date(row.installedAt).toISOString() };
    }),
  };
}

/** Settings › Apps (AC-6501): any member reads it. `canManage` says whether this reader may switch the apps. */
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
 * Turns an app on (AC-6503, AC-6505, AC-6506): `workspace.manage` only; instant. An app that needs another (Menu QR
 * needs Menu) is refused `APP_NEEDED` unless `withNeeded` turns both on in this one step. `business` (the card), sent
 * from an app's first screen while the business isn't set up, is made in the same transaction with the first place,
 * and the "Floor staff" role is seeded with it. On again clears `removed_at`, so everything comes back as it was.
 * Answers the Apps page.
 */
export async function installApp(
  scope: EngineScope,
  input: { readonly app: HospitalityApp; readonly withNeeded?: boolean; readonly business?: FirstBusiness },
  hooks: readonly AfterWrite[] = [],
): Promise<AppsView> {
  requirePermission(scope, 'workspace.manage');
  const by = hospitalityMember(scope);
  // An app still being built can't be turned on: it would only keep a page up with every real app off.
  if (!isApp(input.app) || !APPS_ON_BY_DEFAULT.includes(input.app)) throw refuse('NOT_FOUND', 'There is no such app.');
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      await lockKey(tx, `apps:${scope.workspaceId}`);
      const before = await installedHospitalityApps(tx, scope.workspaceId);
      const needed = APP_NEEDS[input.app].filter((app) => !before.has(app));
      if (needed.length > 0 && input.withNeeded !== true) {
        throw refuse(
          'APP_NEEDED',
          `${APP_NAMES[input.app]} needs ${needed.map((app) => APP_NAMES[app]).join(' and ')}. Turn both on.`,
        );
      }
      const property = await currentProperty(tx, scope.workspaceId);
      const setsUp = property.name === null && input.business !== undefined;
      if (setsUp) {
        // The property's currency and country are the workspace's when it has them, else the card's.
        await tx
          .update(properties)
          .set({
            name: input.business.name,
            kind: input.business.kind,
            currency: sql`coalesce(${properties.currency}, ${input.business.currency})`,
            country: sql`coalesce(${properties.country}, ${input.business.place.country})`,
            createdByMemberId: by,
            updatedByMemberId: by,
            updatedAt: sql`now()`,
          })
          .where(
            and(
              eq(properties.workspaceId, scope.workspaceId),
              eq(properties.id, currentPropertyRef(scope.workspaceId)),
            ),
          );
        // A salon or a clinic opens on a working week, a restaurant on lunch and dinner (Foolproof).
        const firstHours = APPOINTMENT_KINDS.includes(input.business.kind) ? APPOINTMENT_HOURS : RESTAURANT_HOURS;
        const placeId = newId();
        await insertPlace(tx, scope, placeId, { name: input.business.name, ...input.business.place }, by, firstHours);
        await auditSetup(tx, scope, 'business.saved');
        await auditSetup(tx, scope, 'place.created', { placeId });
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
        await seedFloorStaff(tx, scope);
      }
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
        // The first app back makes a published business page live again: back in the sitemap (spec 0066, AC-6644).
        if (before.size === 0) await syncBusinessListing(tx, scope.workspaceId, true);
      }
      // What every member's open sidebar and settings read has changed: an app, or the business now there.
      if (adding.length > 0 || setsUp) await recordSidebars(context);
      return viewOf(tx, scope);
    },
    hooks,
  );
  return result;
}

/**
 * Switches an app off (AC-6503, AC-6505): `workspace.manage` only. Its screens and public pages stop at once, every row is
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
  // An app still being built can't be turned on: it would only keep a page up with every real app off.
  if (!isApp(input.app) || !APPS_ON_BY_DEFAULT.includes(input.app)) throw refuse('NOT_FOUND', 'There is no such app.');
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      await lockKey(tx, `apps:${scope.workspaceId}`);
      const before = await installedHospitalityApps(tx, scope.workspaceId);
      if (!before.has(input.app)) return viewOf(tx, scope);
      const dependents = appsNeeding(input.app).filter((app) => before.has(app));
      if (dependents.length > 0 && input.withDependents !== true) {
        throw refuse(
          'APP_NEEDED',
          `${dependents.map((app) => APP_NAMES[app]).join(' and ')} needs ${APP_NAMES[input.app]}. Turn both off.`,
        );
      }
      const removing = [input.app, ...dependents];
      // An app on by default has no row yet, and the switch-off is the row that keeps it off through every release.
      await tx
        .insert(workspaceApps)
        .values(removing.map((app) => ({ workspaceId: scope.workspaceId, app, removedAt: sql`now()` })))
        .onConflictDoUpdate({
          target: [workspaceApps.workspaceId, workspaceApps.app],
          set: { removedAt: sql`now()` },
        });
      const left = new Set([...before].filter((app) => !removing.includes(app)));
      await auditApps(tx, scope, before, left);
      await recordSidebars(context);
      // The last business app gone takes the business page down: out of the sitemap too (spec 0066, AC-6644).
      if (left.size === 0) await syncBusinessListing(tx, scope.workspaceId, false);
      return viewOf(tx, scope);
    },
    hooks,
  );
  return result;
}
