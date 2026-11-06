// Embedded screens (spec 0070, slice 4, AC-7030 to AC-7033) and the partner sandbox's wipe (AC-7035).
//
// - A launch (`POST /api/partner/v1/connections/{id}/launch`): the partner's server names one of its managed members
//   and a screen; the connection must be live and have the screen's module, the person must still be in the workspace,
//   and Team pages need `link_pages.manage_team`. It answers a one time code (`tfl_`, its public half naming the
//   workspace and the row), good once within 60 seconds; only the SHA-256 of its secret half is stored.
// - The redemption: the frame hands the code over once. It is marked used in the same statement that reads it, so it
//   never works twice, and it is checked again against the connection and the person. What it answers is who the
//   embedded session is for; the api makes that session (12 hours, never extended).
// - The embedded session's reads: whether its connection is still live and has a module (the api's door asks on
//   every call), and what it opens, through the member door itself, so the person's own permissions decide.
// - The sandbox's wipe: a test partner's live test connections, every workspace's, each ended in its workspace with
//   a History row by the system.
import {
  customRolePermissions,
  EMBED_SESSION_HOURS,
  PARTNER_LAUNCH_SECONDS,
  PARTNER_MODULES,
  PARTNER_SCREEN_MODULE,
  PARTNER_SCREENS,
  ROLE_PERMISSIONS,
  type EmbedTheme,
  type PartnerLaunchInput,
  type PartnerModule,
  type PartnerScreen,
} from '@crm/contracts';
import { schema, type Database, type WorkspaceTx } from '@crm/db';
import { and, eq, isNull, lt, sql } from 'drizzle-orm';
import { enterWorkspace, type DoorDeps, type DoorSession } from '../access/door.ts';
import { checkScope, type EngineScope } from '../access/mint.ts';
import { inWorkspace } from '../access/run.ts';
import { pairToken, parsePairToken } from '../developer/tokens.ts';
import { isUuid, newId } from '../engine/ids.ts';
import { refuse } from '../engine/refusals.ts';
import { SYSTEM_ACTOR } from '../engine/scope.ts';
import { writeAudit } from '../members/audit.ts';
import { newPartnerTokenSecret, partnerTokenHash, partnerTokenMatches, type PartnerTokenParts } from './tokens.ts';

const { managedMembers, members, partnerConnections, partnerLaunches, workspaceRoles, workspaces } = schema;

/** A launch's one time code. */
const LAUNCH_PREFIX = 'tfl_';

const NO_CONNECTION = 'There is no such connection.';
const NO_MEMBER = 'This connection has no person with that external id.';

/** A launch's code: names its workspace and launch row, so the redemption never looks across workspaces. */
export function partnerLaunchCode(parts: PartnerTokenParts): string {
  return pairToken(LAUNCH_PREFIX, parts.workspaceId, parts.id, parts.secret);
}

/** A launch code's parts, or undefined for anything that isn't one. */
export function parsePartnerLaunchCode(code: string): PartnerTokenParts | undefined {
  return parsePairToken(LAUNCH_PREFIX, code);
}

/** Modules as stored, kept to the catalog. */
const modulesOf = (stored: readonly string[]): PartnerModule[] =>
  PARTNER_MODULES.filter((module) => stored.includes(module));

/** Whether a member row's role (built in, or the custom role it holds) grants `link_pages.manage_team`. */
function managesTeam(row: { readonly role: string; readonly customPermissions: readonly string[] | null }): boolean {
  if (row.customPermissions !== null)
    return customRolePermissions(row.customPermissions).includes('link_pages.manage_team');
  const builtIn: Readonly<Record<string, readonly string[]>> = ROLE_PERMISSIONS;
  return (builtIn[row.role] ?? []).includes('link_pages.manage_team');
}

/** What a launch answers: the one time code, and when it stops working. */
export interface PartnerLaunch {
  readonly code: string;
  readonly expiresAt: Date;
}

/**
 * Opens a screen for one of the partner's people (AC-7030). Only the scope `enterAsPartner` minted, for the
 * connection it names (another id is `NOT_FOUND`). Refused: a connection without the screen's module (`FORBIDDEN`),
 * an external id the partner never added or removed since (`NOT_FOUND`), a person no longer active in the workspace
 * (`NOT_FOUND`), and Team pages for someone without `link_pages.manage_team` (`FORBIDDEN`).
 */
export async function launchPartnerScreen(
  scope: EngineScope,
  input: { readonly connectionId: string; readonly launch: PartnerLaunchInput },
  deps: { readonly now?: () => Date } = {},
): Promise<PartnerLaunch> {
  checkScope(scope);
  const { principal } = scope.access;
  if (principal.kind !== 'partner') throw refuse('FORBIDDEN', 'Only a partner’s own connection opens its screens.');
  if (principal.connectionId !== input.connectionId) throw refuse('NOT_FOUND', NO_CONNECTION);
  const { externalId, screen, theme } = input.launch;
  if (!PARTNER_SCREENS.includes(screen)) throw refuse('CONFIG_INVALID', 'Pick a screen from the list.');
  const now = (deps.now ?? (() => new Date()))();
  const expiresAt = new Date(now.getTime() + PARTNER_LAUNCH_SECONDS * 1000);
  const secret = newPartnerTokenSecret();
  const id = newId();
  await inWorkspace(scope, async (tx) => {
    const [connection] = await tx
      .select({ modules: partnerConnections.modules })
      .from(partnerConnections)
      .where(and(eq(partnerConnections.id, input.connectionId), isNull(partnerConnections.disconnectedAt)))
      .limit(1);
    if (connection === undefined) throw refuse('NOT_FOUND', NO_CONNECTION);
    if (!modulesOf(connection.modules).includes(PARTNER_SCREEN_MODULE[screen])) {
      throw refuse('FORBIDDEN', 'This connection doesn’t have the module that screen belongs to.');
    }
    const [person] = await tx
      .select({
        memberId: members.id,
        userId: managedMembers.userId,
        role: members.role,
        customPermissions: workspaceRoles.permissions,
      })
      .from(managedMembers)
      .innerJoin(
        members,
        and(eq(members.workspaceId, managedMembers.workspaceId), eq(members.id, managedMembers.memberId)),
      )
      .leftJoin(
        workspaceRoles,
        and(eq(workspaceRoles.workspaceId, members.workspaceId), eq(workspaceRoles.id, members.customRoleId)),
      )
      .where(
        and(
          eq(managedMembers.partnerId, principal.partnerId),
          eq(managedMembers.externalId, externalId),
          isNull(managedMembers.removedAt),
          eq(members.status, 'active'),
        ),
      )
      .limit(1);
    if (person === undefined) throw refuse('NOT_FOUND', NO_MEMBER);
    if (screen === 'link_pages.team' && !managesTeam(person)) {
      throw refuse(
        'FORBIDDEN',
        'This person can’t manage the team’s link pages. Give them the admin role first, or open link_pages.mine.',
      );
    }
    // Yesterday's launches go with today's first: a launch row is only ever read within its minute.
    await tx
      .delete(partnerLaunches)
      .where(lt(partnerLaunches.createdAt, new Date(now.getTime() - 24 * 60 * 60 * 1000)));
    await tx.insert(partnerLaunches).values({
      workspaceId: scope.workspaceId,
      id,
      connectionId: input.connectionId,
      memberId: person.memberId,
      userId: person.userId,
      screen,
      theme: theme ?? null,
      codeHash: partnerTokenHash(secret),
      createdAt: now,
      expiresAt,
    });
  });
  return { code: partnerLaunchCode({ workspaceId: scope.workspaceId, id, secret }), expiresAt };
}

/** A redeemed launch: whom the embedded session is for, where, and what it opens first. */
export interface RedeemedLaunch {
  readonly workspaceId: string;
  readonly connectionId: string;
  readonly partnerId: string;
  readonly userId: string;
  readonly screen: PartnerScreen;
  readonly theme?: EmbedTheme;
  /** When the embedded session it makes ends: 12 hours on, never extended. */
  readonly sessionExpiresAt: Date;
}

/**
 * Redeems a launch's code (AC-7030, AC-7031): once, within its minute, while its connection is live with the screen's
 * module and its person is still in the workspace. The row is marked used by the statement that reads it, so two
 * redemptions at once can't both pass. Undefined for anything else, the same for a malformed, unknown, used, expired
 * or wrong code: the frame says only that the address has run out.
 */
export async function redeemPartnerLaunch(
  deps: { readonly db: Database; readonly now?: () => Date },
  code: string,
): Promise<RedeemedLaunch | undefined> {
  const parts = parsePartnerLaunchCode(code);
  if (parts === undefined) return undefined;
  const now = (deps.now ?? (() => new Date()))();
  return deps.db.withWorkspace(parts.workspaceId, async (tx) => {
    const [launch] = await tx
      .select({
        connectionId: partnerLaunches.connectionId,
        memberId: partnerLaunches.memberId,
        userId: partnerLaunches.userId,
        screen: partnerLaunches.screen,
        theme: partnerLaunches.theme,
        codeHash: partnerLaunches.codeHash,
        expiresAt: partnerLaunches.expiresAt,
        usedAt: partnerLaunches.usedAt,
      })
      .from(partnerLaunches)
      .where(eq(partnerLaunches.id, parts.id))
      .for('update');
    if (launch === undefined || !partnerTokenMatches(parts.secret, launch.codeHash)) return undefined;
    if (launch.usedAt !== null || new Date(launch.expiresAt).getTime() <= now.getTime()) return undefined;
    await tx.update(partnerLaunches).set({ usedAt: now }).where(eq(partnerLaunches.id, parts.id));
    const screen = PARTNER_SCREENS.find((each) => each === launch.screen);
    if (screen === undefined) return undefined;
    const [live] = await tx
      .select({ partnerId: partnerConnections.partnerId, modules: partnerConnections.modules })
      .from(partnerConnections)
      .innerJoin(workspaces, eq(workspaces.id, partnerConnections.workspaceId))
      .innerJoin(
        managedMembers,
        and(
          eq(managedMembers.workspaceId, partnerConnections.workspaceId),
          eq(managedMembers.partnerId, partnerConnections.partnerId),
          eq(managedMembers.memberId, launch.memberId),
          // The identity the launch named, still the person's: never someone the external id was moved to since.
          eq(managedMembers.userId, launch.userId),
          isNull(managedMembers.removedAt),
        ),
      )
      .innerJoin(
        members,
        and(
          eq(members.workspaceId, managedMembers.workspaceId),
          eq(members.id, managedMembers.memberId),
          eq(members.status, 'active'),
        ),
      )
      .where(
        and(
          eq(partnerConnections.id, launch.connectionId),
          isNull(partnerConnections.disconnectedAt),
          isNull(workspaces.deletedAt),
        ),
      )
      .limit(1);
    if (live === undefined || !modulesOf(live.modules).includes(PARTNER_SCREEN_MODULE[screen])) return undefined;
    const theme = launch.theme === 'light' || launch.theme === 'dark' ? launch.theme : undefined;
    return {
      workspaceId: parts.workspaceId,
      connectionId: launch.connectionId,
      partnerId: live.partnerId,
      userId: launch.userId,
      screen,
      ...(theme === undefined ? {} : { theme }),
      sessionExpiresAt: new Date(now.getTime() + EMBED_SESSION_HOURS * 60 * 60 * 1000),
    };
  });
}

/**
 * The modules an embedded session's connection still has (AC-7033), or undefined once it is disconnected or its
 * workspace deleted: the api's door asks on every call an embedded session makes.
 */
export async function embedConnectionModules(
  deps: { readonly db: Database },
  embed: { readonly workspaceId: string; readonly connectionId: string },
): Promise<readonly PartnerModule[] | undefined> {
  if (!isUuid(embed.workspaceId) || !isUuid(embed.connectionId)) return undefined;
  const [row] = await deps.db.withWorkspace(embed.workspaceId, (tx) =>
    tx
      .select({ modules: partnerConnections.modules })
      .from(partnerConnections)
      .innerJoin(workspaces, eq(workspaces.id, partnerConnections.workspaceId))
      .where(
        and(
          eq(partnerConnections.id, embed.connectionId),
          isNull(partnerConnections.disconnectedAt),
          isNull(workspaces.deletedAt),
        ),
      )
      .limit(1),
  );
  return row === undefined ? undefined : modulesOf(row.modules);
}

/** What an embedded session opens, before the partner's own name and frame origins join it. */
export interface EmbedSessionFacts {
  readonly slug: string;
  readonly workspaceName: string;
  readonly partnerId: string;
  readonly modules: readonly PartnerModule[];
  readonly personName: string;
  readonly canManageTeam: boolean;
}

/**
 * What an embedded session opens (AC-7031): its workspace, its connection's partner and modules, and through the
 * member door itself, the person's name and whether they may manage the team's link pages. `NOT_FOUND` once the
 * connection is gone or the person is no longer in the workspace.
 */
export async function describeEmbedSession(
  deps: DoorDeps,
  input: {
    readonly userId: string;
    readonly workspaceId: string;
    readonly connectionId: string;
    readonly session: DoorSession;
  },
): Promise<EmbedSessionFacts> {
  const gone = () => refuse('NOT_FOUND', 'This screen is no longer shared. Open it again from the app you came from.');
  if (!isUuid(input.workspaceId) || !isUuid(input.connectionId)) throw gone();
  const [row] = await deps.db.withWorkspace(input.workspaceId, (tx: WorkspaceTx) =>
    tx
      .select({
        slug: workspaces.slug,
        name: workspaces.name,
        partnerId: partnerConnections.partnerId,
        modules: partnerConnections.modules,
      })
      .from(partnerConnections)
      .innerJoin(workspaces, eq(workspaces.id, partnerConnections.workspaceId))
      .where(
        and(
          eq(partnerConnections.id, input.connectionId),
          isNull(partnerConnections.disconnectedAt),
          isNull(workspaces.deletedAt),
        ),
      )
      .limit(1),
  );
  if (row === undefined) throw gone();
  const scope = await enterWorkspace(deps, { userId: input.userId, slug: row.slug, session: input.session });
  const [person] = await deps.db.withWorkspace(input.workspaceId, (tx) =>
    tx
      .select({ name: members.name })
      .from(members)
      .where(eq(members.id, scope.actor.id ?? ''))
      .limit(1),
  );
  return {
    slug: row.slug,
    workspaceName: row.name,
    partnerId: row.partnerId,
    modules: modulesOf(row.modules),
    personName: person?.name ?? '',
    canManageTeam: scope.access.permissions.includes('link_pages.manage_team'),
  };
}

/**
 * A sandbox partner's live test connections ended in one go (AC-7035), every workspace's (at most 1,000 a call): each
 * is disconnected in its own workspace with a `partner.disconnected` History row by the system. Answers the ended
 * connections' ids, for the api to end their embedded sessions. Who may call it is the operator gate's, and that the
 * partner is a sandbox one the caller's (the definer reads only connections marked as test either way).
 */
export async function wipeTestConnections(
  deps: { readonly db: Database },
  partner: { readonly id: string; readonly name: string },
): Promise<readonly string[]> {
  if (!isUuid(partner.id)) return [];
  const found = await deps.db.withWorkspace('00000000-0000-0000-0000-000000000000', (tx) =>
    tx.execute(sql`select workspace_id, connection_id from crm_operator_partner_connections(${partner.id}::uuid)`),
  );
  const rows = (found.rows as { workspace_id: string; connection_id: string }[]).filter(
    (row) => isUuid(row.workspace_id) && isUuid(row.connection_id),
  );
  const ended: string[] = [];
  for (const row of rows) {
    const done = await deps.db.withWorkspace(row.workspace_id, async (tx) => {
      const [gone] = await tx
        .update(partnerConnections)
        .set({ disconnectedAt: sql`now()`, updatedAt: sql`now()` })
        .where(
          and(
            eq(partnerConnections.id, row.connection_id),
            eq(partnerConnections.isTest, true),
            isNull(partnerConnections.disconnectedAt),
          ),
        )
        .returning({ modules: partnerConnections.modules });
      if (gone === undefined) return false;
      await writeAudit(tx, row.workspace_id, SYSTEM_ACTOR, {
        action: 'partner.disconnected',
        targetType: 'workspace',
        targetId: row.workspace_id,
        after: { name: partner.name, modules: modulesOf(gone.modules), reason: 'sandbox_wiped' },
      });
      return true;
    });
    if (done) ended.push(row.connection_id);
  }
  return ended;
}
