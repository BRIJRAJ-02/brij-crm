// Settings › Account › Preferences: each member's own time zone, date
// format, week start and landing page in one workspace, and the Home sections
// they put away (spec 0041). Only a member reads
// or changes them, and only their own: there is no way to name another
// member. A member who never changed anything has no row and reads the
// defaults. A change writes its row and one audit entry in one transaction,
// with no outbox row (nobody else holds a member's preferences).
import { and, eq, isNull } from 'drizzle-orm';
import {
  DEFAULT_PREFERENCES,
  type DateFormat,
  type LandingPage,
  type MemberPreferences,
  type UpdatePreferencesInput,
  type WeekStart,
} from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import { checkScope, type EngineScope } from '../access/mint.ts';
import { inWorkspace } from '../access/run.ts';
import { checkObject, UNKNOWN_OBJECT } from '../access/visibility.ts';
import { refuse } from '../engine/refusals.ts';
import { writeAudit, type AuditSource } from './audit.ts';

const { memberPreferences, members, objects } = schema;

/** What a principal that isn't a member answers: preferences belong to members. */
export const PREFERENCES_MEMBERS_ONLY = 'Preferences belong to members.';

/** The caller's member id, or 403 `FORBIDDEN` for an API key, a form, a booking page or the system. */
function callerOf(scope: EngineScope): string {
  const { principal } = scope.access;
  if (principal.kind !== 'member') throw refuse('FORBIDDEN', PREFERENCES_MEMBERS_ONLY);
  return principal.memberId;
}

/** A stored row as the contract's shape. */
type Row = typeof memberPreferences.$inferSelect;

function landingOf(row: Pick<Row, 'landing' | 'landingId'>): LandingPage {
  if (row.landing === 'object' && row.landingId !== null) return { kind: 'object', objectId: row.landingId };
  return row.landing === 'tasks' ? { kind: 'tasks' } : { kind: 'home' };
}

function viewOf(row: Row | undefined): MemberPreferences {
  if (row === undefined) return DEFAULT_PREFERENCES;
  return {
    ...(row.timeZone === null ? {} : { timeZone: row.timeZone }),
    dateFormat: row.dateFormat as DateFormat,
    weekStart: row.weekStart as WeekStart,
    landing: landingOf(row),
    ...(row.homeHidden.length === 0 ? {} : { homeHidden: row.homeHidden }),
  };
}

async function readRow(tx: WorkspaceTx, scope: EngineScope, memberId: string, lock: boolean): Promise<Row | undefined> {
  const query = tx
    .select()
    .from(memberPreferences)
    .where(and(eq(memberPreferences.workspaceId, scope.workspaceId), eq(memberPreferences.memberId, memberId)));
  const [row] = lock ? await query.for('update') : await query;
  return row;
}

/** The caller's own preferences in this workspace (members only); the defaults until they change one. */
export async function readMyPreferences(scope: EngineScope): Promise<MemberPreferences> {
  checkScope(scope);
  const memberId = callerOf(scope);
  return inWorkspace(scope, async (tx) => viewOf(await readRow(tx, scope, memberId, false)));
}

/** Refuses a landing object the caller can't open: unknown, archived, or hidden from them all answer the same. */
async function checkLanding(tx: WorkspaceTx, scope: EngineScope, landing: LandingPage): Promise<void> {
  if (landing.kind !== 'object') return;
  const [found] = await tx
    .select({ id: objects.id })
    .from(objects)
    .where(
      and(eq(objects.workspaceId, scope.workspaceId), eq(objects.id, landing.objectId), isNull(objects.archivedAt)),
    );
  if (found === undefined) throw refuse('NOT_FOUND', UNKNOWN_OBJECT);
  await checkObject(tx, scope.access, landing.objectId, 'read');
}

/**
 * Changes the caller's own preferences (members only, an active one): only the
 * fields `input` names; `timeZone` null goes back to the browser's. A landing
 * object must be one they can open. Writes one `member.preferences_changed`
 * audit entry with the changed fields, before and after; a change to nothing
 * writes nothing. Answers the preferences as stored.
 */
export async function updateMyPreferences(
  scope: EngineScope,
  input: Pick<UpdatePreferencesInput, 'timeZone' | 'dateFormat' | 'weekStart' | 'landing' | 'homeHidden'> = {},
  source: AuditSource = {},
): Promise<MemberPreferences> {
  checkScope(scope);
  const memberId = callerOf(scope);
  return inWorkspace(scope, async (tx) => {
    const [member] = await tx
      .select({ status: members.status })
      .from(members)
      .where(and(eq(members.workspaceId, scope.workspaceId), eq(members.id, memberId)))
      .for('share');
    if (member?.status !== 'active') throw refuse('FORBIDDEN', 'You are no longer a member of this workspace.');
    const before = viewOf(await readRow(tx, scope, memberId, true));
    const after: MemberPreferences = {
      ...(input.timeZone === null
        ? {}
        : input.timeZone === undefined
          ? before.timeZone === undefined
            ? {}
            : { timeZone: before.timeZone }
          : { timeZone: input.timeZone }),
      dateFormat: input.dateFormat ?? before.dateFormat,
      weekStart: input.weekStart ?? before.weekStart,
      landing: input.landing ?? before.landing,
      ...homeHiddenOf(input.homeHidden ?? before.homeHidden),
    };
    const changed = changedFields(before, after);
    if (changed.length === 0) return before;
    if (changed.includes('landing')) await checkLanding(tx, scope, after.landing);
    const stored = {
      timeZone: after.timeZone ?? null,
      dateFormat: after.dateFormat,
      weekStart: after.weekStart,
      landing: after.landing.kind,
      landingId: after.landing.kind === 'object' ? after.landing.objectId : null,
      homeHidden: [...(after.homeHidden ?? [])],
    };
    await tx
      .insert(memberPreferences)
      .values({ workspaceId: scope.workspaceId, memberId, ...stored })
      .onConflictDoUpdate({
        target: [memberPreferences.workspaceId, memberPreferences.memberId],
        set: { ...stored, updatedAt: new Date() },
      });
    await writeAudit(
      tx,
      scope.workspaceId,
      scope.actor,
      {
        action: 'member.preferences_changed',
        targetType: 'member',
        targetId: memberId,
        before: pick(before, changed),
        after: pick(after, changed),
      },
      source,
    );
    return after;
  });
}

type Field = keyof MemberPreferences;
const FIELDS: readonly Field[] = ['timeZone', 'dateFormat', 'weekStart', 'landing', 'homeHidden'];

/** The Home sections put away as the view holds them: absent when none, so an empty list reads as the defaults. */
function homeHiddenOf(keys: readonly string[] | undefined): Pick<MemberPreferences, 'homeHidden'> {
  return keys === undefined || keys.length === 0 ? {} : { homeHidden: [...keys] };
}

/** The fields whose values differ (the landing compared by its stored form). */
export function changedFields(before: MemberPreferences, after: MemberPreferences): readonly Field[] {
  return FIELDS.filter((field) => JSON.stringify(before[field] ?? null) !== JSON.stringify(after[field] ?? null));
}

/** Only `fields` of `view`, a missing time zone as null (the browser's). */
function pick(view: MemberPreferences, fields: readonly Field[]): Readonly<Record<string, unknown>> {
  return Object.fromEntries(fields.map((field) => [field, view[field] ?? null]));
}
