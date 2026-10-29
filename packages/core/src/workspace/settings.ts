// Settings › Workspace › General (spec 0031, slice 7, AC-822, AC-823): the
// open workspace's name, default time zone and address, and the owner's
// delete and restore. Every change writes its audit row in its own
// transaction. The directory's copy of the name and its deleted mark live in
// schema auth, which the app may not update (migration 0018), so the caller
// writes them through the identity store once the change commits; the access
// door reads the tenant row, so a deleted workspace is shut either way. A new
// address is the exception: the directory finds the workspace by it, so it
// moves in the same transaction, through the one function the app may call
// there (`crm_claim_workspace_address`, migration 0083), which keeps the old
// address the workspace's own.
import {
  namesMatch,
  WORKSPACE_PURGE_DAYS,
  type DeletedWorkspace,
  type UpdateWorkspaceInput,
  type WorkspaceSettings,
} from '@crm/contracts';
import {
  ADDRESS_CLAIM_CONSTRAINT,
  claimWorkspaceAddress,
  DIRECTORY_SLUG_CONSTRAINT,
  schema,
  type WorkspaceTx,
} from '@crm/db';
import { and, eq, gt, isNotNull, isNull, sql } from 'drizzle-orm';
import { requirePermission } from '../access/check.ts';
import { checkScope } from '../access/mint.ts';
import type { EngineScope } from '../engine/scope.ts';
import { inWorkspace } from '../access/run.ts';
import { touched } from '../engine/definitions.ts';
import { uuidList } from '../engine/ids.ts';
import { postgresError, refuse, refuseOn } from '../engine/refusals.ts';
import { runWrite, type AfterWrite } from '../engine/write.ts';
import { writeAudit, type AuditSource } from '../members/audit.ts';

const { members, workspaces } = schema;

const NOT_A_MEMBER = "That workspace doesn't exist, or you're not a member of it.";

/**
 * How far apart a deletion's or a restore's calendar runs are queued, in seconds: one tenant's bulk never queues ahead
 * of every other tenant's notices, which run at the same priority (`crm_enqueue_calendar_sync`'s).
 */
export const CALENDAR_SPREAD_SECONDS = 1;

/** A workspace address (spec 0005): the rule a new workspace's address follows, which the database checks too. */
const WORKSPACE_SLUG = /^(?=.{3,40}$)[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The keys a taken address trips: live workspaces, the directory, and every address a workspace ever held. */
const ADDRESS_TAKEN: ReadonlySet<string> = new Set([
  'workspaces_slug',
  DIRECTORY_SLUG_CONSTRAINT,
  ADDRESS_CLAIM_CONSTRAINT,
]);

/** The refusal for an address another workspace holds or held. */
const ADDRESS_TAKEN_MESSAGE = 'That address is taken. Try another.';

/** The settings columns, as the contract answers them. */
const SETTINGS = {
  id: workspaces.id,
  name: workspaces.name,
  slug: workspaces.slug,
  timeZone: workspaces.timeZone,
  logoUrl: workspaces.logoUrl,
} as const;

function toSettings(row: {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly timeZone: string;
  readonly logoUrl: string | null;
}): WorkspaceSettings {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    timeZone: row.timeZone,
    ...(row.logoUrl === null ? {} : { logoUrl: row.logoUrl }),
  };
}

/** The live workspace's settings row, locked for a change when `lock`; NOT_FOUND once it is deleted. */
async function liveRow(tx: WorkspaceTx, scope: EngineScope, lock: boolean) {
  const query = tx
    .select(SETTINGS)
    .from(workspaces)
    .where(and(eq(workspaces.id, scope.workspaceId), isNull(workspaces.deletedAt)));
  const [row] = lock ? await query.for('update') : await query;
  if (row === undefined) throw refuse('NOT_FOUND', NOT_A_MEMBER);
  return row;
}

/** The open workspace's settings (any member: every member sees its name, address and time zone). */
export async function getWorkspaceSettings(scope: EngineScope): Promise<WorkspaceSettings> {
  checkScope(scope);
  return inWorkspace(scope, async (tx) => toSettings(await liveRow(tx, scope, false)));
}

/** What a settings change did: the settings now, and whether the name changed (the directory's copy follows). */
export interface UpdatedWorkspace {
  readonly settings: WorkspaceSettings;
  readonly renamed: boolean;
}

/**
 * Renames the workspace (1 to 64 characters), changes its default time
 * zone, and moves it to a new address (`workspace.manage`, AC-822). A change
 * that changes nothing writes nothing; otherwise one audit row with the
 * changed fields only. A new address follows the new workspace rule
 * (`CONFIG_INVALID` on `slug`) and must be free: one another workspace holds
 * or ever held is refused `SLUG_TAKEN` on `slug`, and a 21st address
 * `LIMIT_REACHED`. The old address stays the workspace's, so links with it
 * keep working.
 */
export async function updateWorkspace(
  scope: EngineScope,
  input: Pick<UpdateWorkspaceInput, 'name' | 'timeZone' | 'slug'>,
  hooks: readonly AfterWrite[] = [],
  source: AuditSource = {},
): Promise<UpdatedWorkspace> {
  requirePermission(scope, 'workspace.manage');
  const name = input.name?.trim();
  if (name !== undefined && (name.length < 1 || name.length > 64)) {
    throw refuseOn('CONFIG_INVALID', 'Use 1 to 64 characters for the name.', 'name');
  }
  if (input.slug !== undefined && !WORKSPACE_SLUG.test(input.slug)) {
    throw refuseOn(
      'CONFIG_INVALID',
      'Use 3 to 40 lowercase letters and digits, with single dashes between them.',
      'slug',
    );
  }
  const { result } = await runWrite(
    scope,
    async ({ tx }) => {
      const now = await liveRow(tx, scope, true);
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      if (name !== undefined && name !== now.name) {
        before.name = now.name;
        after.name = name;
      }
      if (input.timeZone !== undefined && input.timeZone !== now.timeZone) {
        before.timeZone = now.timeZone;
        after.timeZone = input.timeZone;
      }
      if (input.slug !== undefined && input.slug !== now.slug) {
        before.slug = now.slug;
        after.slug = input.slug;
      }
      if (Object.keys(after).length === 0) return { settings: toSettings(now), renamed: false };
      // The directory first: its claim is the one that sees every address any workspace ever held.
      if (input.slug !== undefined && after.slug !== undefined) await claimAddress(tx, input.slug);
      const [row] = await tx
        .update(workspaces)
        .set({
          ...(name === undefined || after.name === undefined ? {} : { name }),
          ...(after.timeZone === undefined || input.timeZone === undefined ? {} : { timeZone: input.timeZone }),
          ...(after.slug === undefined || input.slug === undefined ? {} : { slug: input.slug }),
          ...touched(scope),
        })
        .where(eq(workspaces.id, scope.workspaceId))
        .returning(SETTINGS)
        .catch((error: unknown) => {
          throw addressRefusal(error);
        });
      if (row === undefined) throw refuse('NOT_FOUND', NOT_A_MEMBER);
      await writeAudit(
        tx,
        scope.workspaceId,
        scope.actor,
        { action: 'workspace.updated', targetType: 'workspace', targetId: scope.workspaceId, before, after },
        source,
      );
      return { settings: toSettings(row), renamed: after.name !== undefined };
    },
    hooks,
  );
  return result;
}

/** Claims `slug` in the directory for the open workspace, refusing `SLUG_TAKEN` when another holds or held it. */
async function claimAddress(tx: WorkspaceTx, slug: string): Promise<void> {
  try {
    await claimWorkspaceAddress(tx, slug);
  } catch (error) {
    throw addressRefusal(error);
  }
}

/** A taken address's unique violation as the `SLUG_TAKEN` refusal on `slug`; anything else as it was. */
function addressRefusal(error: unknown): unknown {
  const pg = postgresError(error);
  if (pg?.code === '23505' && pg.constraint !== undefined && ADDRESS_TAKEN.has(pg.constraint)) {
    return refuseOn('SLUG_TAKEN', ADDRESS_TAKEN_MESSAGE, 'slug');
  }
  // The claim keeps at most 20 addresses a workspace (migration 0083), so none can hoard names.
  if (pg?.code === '54000' && error instanceof Error && /WORKSPACE_ADDRESS_LIMIT/.test(messageChain(error))) {
    return refuseOn(
      'LIMIT_REACHED',
      'This workspace has changed its address too many times. Pick one it used before.',
      'slug',
    );
  }
  return error;
}

/** An error's message and its causes', for a database message wrapped by the driver. */
function messageChain(error: Error): string {
  return error.cause instanceof Error ? `${error.message} ${messageChain(error.cause)}` : error.message;
}

/** A restored workspace: its settings, and who to tell and in whose name. */
export interface WorkspaceRestoration {
  readonly settings: WorkspaceSettings;
  /** The active members but the restorer, for the email each gets. */
  readonly notify: readonly { readonly email: string; readonly name: string }[];
  /** The restoring owner's name in this workspace, for the email. */
  readonly restoredBy: string;
}

/** What a delete did: the workspace as its owners see it in the window, and who to tell. */
export interface WorkspaceDeletion {
  readonly deleted: DeletedWorkspace;
  /** The active members' addresses and names, for the email each gets (AC-823). */
  readonly notify: readonly { readonly email: string; readonly name: string; readonly isOwner: boolean }[];
  /** The deleting owner's name in this workspace, for the email. */
  readonly deletedBy: string;
}

/**
 * Deletes the workspace, softly (`workspace.delete`, owners only, AC-823):
 * the owner types its name to confirm (422 `CONFIRM_MISMATCH` on the
 * `confirmName` field otherwise). `deleted_at` and `purge_after` (30 days on)
 * are set in one transaction with the audit row, and from the next request
 * the door refuses every member as for an unknown address. The same
 * transaction brings forward the calendar run of each account with a push
 * channel, which ends its channels at the provider (calendar sync stops with
 * the workspace). Answers who to email; the caller sends it once this commits.
 */
export async function deleteWorkspace(
  scope: EngineScope,
  input: { readonly confirmName: string },
  hooks: readonly AfterWrite[] = [],
  source: AuditSource = {},
): Promise<WorkspaceDeletion> {
  requirePermission(scope, 'workspace.delete');
  const { result } = await runWrite(
    scope,
    async ({ tx }) => {
      const now = await liveRow(tx, scope, true);
      if (!namesMatch(input.confirmName, now.name)) {
        throw refuseOn('CONFIRM_MISMATCH', `Type ${now.name} to confirm.`, 'confirmName');
      }
      const [row] = await tx
        .update(workspaces)
        .set({
          deletedAt: sql`now()`,
          purgeAfter: sql`now() + make_interval(days => ${WORKSPACE_PURGE_DAYS})`,
          ...touched(scope),
        })
        .where(eq(workspaces.id, scope.workspaceId))
        .returning({ deletedAt: workspaces.deletedAt, purgeAfter: workspaces.purgeAfter });
      if (row === undefined || row.purgeAfter === null || row.deletedAt === null)
        throw refuse('NOT_FOUND', NOT_A_MEMBER);
      // Calendar sync stops with the workspace: each account holding a push channel has its next run brought forward,
      // and that run ends the channels at the provider and syncs nothing, so no notice wakes a deleted workspace. A
      // failing account's own retry does the same; a restore queues each account again. The runs are spread a
      // second apart (`CALENDAR_SPREAD_SECONDS`), so one big workspace's deletion never queues ahead of every other
      // tenant's notices; a notice that arrives for one meanwhile brings that one forward.
      await tx.execute(sql`
        select crm_enqueue_calendar_sync(c.id,
          now() + (row_number() over (order by c.id) - 1) * make_interval(secs => ${CALENDAR_SPREAD_SECONDS}))
        from calendar_connections c
        where c.workspace_id = ${scope.workspaceId}::uuid and c.status in ('syncing', 'connected')
          and exists (select 1 from calendar_calendars k
            where k.workspace_id = c.workspace_id and k.connection_id = c.id and k.channel ->> 'id' is not null)
      `);
      await writeAudit(
        tx,
        scope.workspaceId,
        scope.actor,
        {
          action: 'workspace.deleted',
          targetType: 'workspace',
          targetId: scope.workspaceId,
          before: { deletedAt: null },
          after: { deletedAt: row.deletedAt, purgeAfter: row.purgeAfter },
        },
        source,
      );
      const people = await tx
        .select({ id: members.id, email: members.email, name: members.name, role: members.role })
        .from(members)
        .where(and(eq(members.workspaceId, scope.workspaceId), eq(members.status, 'active')));
      const actor = scope.actor.type === 'member' ? scope.actor.id : undefined;
      return {
        deleted: { name: now.name, slug: now.slug, purgeAfter: new Date(row.purgeAfter).toISOString() },
        notify: people.map((person) => ({ email: person.email, name: person.name, isOwner: person.role === 'owner' })),
        deletedBy: people.find((person) => person.id === actor)?.name ?? 'An owner',
      };
    },
    hooks,
  );
  return result;
}

/**
 * Restores a deleted workspace within its window (AC-823): the scope must be
 * an owner's, made by `enterDeletedWorkspace` (the door refuses a deleted
 * workspace otherwise). Clears `deleted_at` and `purge_after` with the audit
 * row; NOT_FOUND once the window has passed or it was restored already.
 * Answers its settings, and who to tell: every active member but the one who
 * restored it, each told of the deletion (late trap #89).
 */
export async function restoreWorkspace(
  scope: EngineScope,
  hooks: readonly AfterWrite[] = [],
  source: AuditSource = {},
): Promise<WorkspaceRestoration> {
  requirePermission(scope, 'workspace.delete');
  const { result } = await runWrite(
    scope,
    async ({ tx }) => {
      // The restorer is still an active owner now (any active owner, for a system scope): one who left meanwhile
      // (deleting their account leaves a deleted workspace, spec 0033) can't bring it back with nobody to own it.
      // Member rows are locked before the workspace's, in the order a removal takes them, so the two take turns.
      const actor = scope.actor.type === 'member' ? scope.actor.id : null;
      const [owner] = await tx
        .select({ id: members.id })
        .from(members)
        .where(
          and(
            eq(members.workspaceId, scope.workspaceId),
            eq(members.status, 'active'),
            eq(members.role, 'owner'),
            ...(actor === null ? [] : [eq(members.id, actor)]),
          ),
        )
        .limit(1)
        .for('share');
      if (owner === undefined) throw refuse('NOT_FOUND', NOT_A_MEMBER);
      const [row] = await tx
        .update(workspaces)
        .set({ deletedAt: null, purgeAfter: null, ...touched(scope) })
        .where(
          and(
            eq(workspaces.id, scope.workspaceId),
            isNotNull(workspaces.deletedAt),
            gt(workspaces.purgeAfter, sql`now()`),
          ),
        )
        .returning(SETTINGS);
      if (row === undefined) throw refuse('NOT_FOUND', NOT_A_MEMBER);
      // Calendar sync stopped while it was deleted: each connection that syncs starts again, spread a second apart as
      // a deletion's runs are. The queue function only takes a connection that may sync now, so a failed one (which
      // keeps trying at the poll's pace, and heals by itself) is marked syncing for the moment it is queued, then
      // failed again; all of this is one transaction, so nobody sees it.
      const failing = await tx.execute<{ id: string }>(sql`
        update calendar_connections set status = 'syncing'
        where workspace_id = ${scope.workspaceId}::uuid and status = 'failed'
        returning id::text as id
      `);
      await tx.execute(sql`
        select crm_enqueue_calendar_sync(c.id,
          now() + (row_number() over (order by c.id) - 1) * make_interval(secs => ${CALENDAR_SPREAD_SECONDS}))
        from calendar_connections c
        where c.workspace_id = ${scope.workspaceId}::uuid and c.status in ('syncing', 'connected')
      `);
      if (failing.rows.length > 0) {
        await tx.execute(sql`
          update calendar_connections set status = 'failed' where id = any(${uuidList(failing.rows.map((each) => each.id))})
        `);
      }
      await writeAudit(
        tx,
        scope.workspaceId,
        scope.actor,
        {
          action: 'workspace.restored',
          targetType: 'workspace',
          targetId: scope.workspaceId,
          after: { deletedAt: null },
        },
        source,
      );
      const people = await tx
        .select({ id: members.id, email: members.email, name: members.name })
        .from(members)
        .where(and(eq(members.workspaceId, scope.workspaceId), eq(members.status, 'active')));
      return {
        settings: toSettings(row),
        notify: people
          .filter((person) => person.id !== actor)
          .map((person) => ({ email: person.email, name: person.name })),
        restoredBy: people.find((person) => person.id === actor)?.name ?? 'An owner',
      };
    },
    hooks,
  );
  return result;
}
