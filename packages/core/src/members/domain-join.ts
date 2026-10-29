// Domain join (spec 0031, slice 6, AC-819, AC-820): a workspace's email
// domains, whose signed in people with a verified address there may ask to
// join from `/join`, and the requests owners and admins approve or decline.
// Domains need `workspace.manage` and only the caller's own verified email's
// domain may be added, never a public mail domain; requests need
// `members.invite`. Asking runs before the person is a member, through the
// door's domain lookup and a system scope in each workspace. Every change
// writes its audit row in its own transaction.
import { and, asc, desc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import {
  domainOf,
  PERMISSIONS,
  isPublicEmailDomain,
  ROLE_PERMISSIONS,
  type Joinable,
  type JoinRequestView,
  type WorkspaceDomainsView,
} from '@crm/contracts';
import { schema, type Database, type WorkspaceTx } from '@crm/db';
import { enterDomainWorkspace, enterDomainWorkspaces } from '../access/door.ts';
import { checkScope } from '../access/mint.ts';
import { can } from '../access/policy.ts';
import { inWorkspace } from '../access/run.ts';
import { touched } from '../engine/definitions.ts';
import { checkId, newId } from '../engine/ids.ts';
import { refuse } from '../engine/refusals.ts';
import { actorRow, type EngineScope } from '../engine/scope.ts';
import { runWrite, type AfterWrite } from '../engine/write.ts';
import { recordJoinReach } from '../scheduling/delegations.ts';
import { ensureLinkPage } from '../booking/handles.ts';
import { writeAudit } from './audit.ts';
import {
  addJoiner,
  joinerName,
  checkActingNow,
  checkInvites,
  checkSeats,
  plainName,
  type InviteWriteOptions,
} from './invitations.ts';

const { joinRequests, members, workspaceDomains, workspaces } = schema;

/** How long a declined request still reads as pending to the person who asked (AC-820). */
const DECLINE_QUIET_DAYS = 30;

/** At most this many open requests on the tab: past it the oldest wait for the next read. */
const REQUESTS_MAX = 200;

const REQUEST_NOT_FOUND = "That request doesn't exist, or someone already answered it.";
const WORKSPACE_NOT_FOUND = "That workspace doesn't exist, or you can't ask to join it.";

/** The signed in person as the session knows them: who asks, and whose domain an admin may add. */
export interface SessionPerson {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly emailVerified: boolean;
}

/** Whether a domain is a public mail domain (gmail.com and the like). */
const isPublic = (domain: string): boolean => isPublicEmailDomain(domain);

/** The person's own domain when they may use it to join or to open a workspace to: verified, and not public. */
function ownDomain(person: Pick<SessionPerson, 'email' | 'emailVerified'>): string | undefined {
  const domain = domainOf(person.email);
  return person.emailVerified && domain !== '' && !isPublic(domain) ? domain : undefined;
}

/** Refuses FORBIDDEN unless the scope holds `workspace.manage`, before anything is read. */
function checkManagesWorkspace(scope: EngineScope): void {
  checkScope(scope);
  if (!can(scope.access, 'workspace.manage')) throw refuse('FORBIDDEN', PERMISSIONS['workspace.manage'].message);
}

/** The workspace's domains, A to Z. */
async function domainsOf(tx: WorkspaceTx, workspaceId: string): Promise<string[]> {
  const rows = await tx
    .select({ domain: workspaceDomains.domain })
    .from(workspaceDomains)
    .where(eq(workspaceDomains.workspaceId, workspaceId))
    .orderBy(asc(workspaceDomains.domain));
  return rows.map((row) => row.domain);
}

/** The view for `viewer`: the domains on, and the one they may turn on. */
function domainsView(domains: readonly string[], viewer: Pick<SessionPerson, 'email' | 'emailVerified'>) {
  const mine = ownDomain(viewer);
  const view: WorkspaceDomainsView = {
    domains: [...domains],
    ...(mine === undefined ? {} : { yourDomain: mine }),
    isPublic: isPublic(domainOf(viewer.email)),
  };
  return view;
}

/**
 * The workspace's email domains (spec 0031, AC-819), for Settings ›
 * Members: needs `workspace.manage`. Says which domain `viewer` (the signed
 * in person) may turn on: their own verified email's, unless public.
 */
export async function getWorkspaceDomains(
  scope: EngineScope,
  viewer: Pick<SessionPerson, 'email' | 'emailVerified'>,
): Promise<WorkspaceDomainsView> {
  checkManagesWorkspace(scope);
  return domainsView(await inWorkspace(scope, (tx) => domainsOf(tx, scope.workspaceId)), viewer);
}

/**
 * Sets the workspace's email domains (spec 0031, AC-819): needs
 * `workspace.manage`. A domain added must be `viewer`'s own verified email's
 * (422 `DOMAIN_NOT_YOURS`) and never a public mail domain (422
 * `DOMAIN_PUBLIC`); one already on may stay or go. One audit row when
 * anything changed.
 */
export async function setWorkspaceDomains(
  scope: EngineScope,
  input: { readonly domains: readonly string[] },
  viewer: Pick<SessionPerson, 'email' | 'emailVerified'>,
  hooks: readonly AfterWrite[] = [],
  options: InviteWriteOptions = {},
): Promise<WorkspaceDomainsView> {
  checkManagesWorkspace(scope);
  const wanted = [...new Set(input.domains.map((domain) => domain.trim().toLowerCase()).filter((d) => d !== ''))];
  const { result } = await runWrite(
    scope,
    async ({ tx }) => {
      // One save at a time per workspace, so two admins adding the same domain never collide.
      await tx
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(eq(workspaces.id, scope.workspaceId))
        .for('no key update');
      const before = await domainsOf(tx, scope.workspaceId);
      const added = wanted.filter((domain) => !before.includes(domain));
      for (const domain of added) {
        if (isPublic(domain))
          throw refuse('DOMAIN_PUBLIC', `Anyone can have an address at ${domain}, so it can't be used to join.`);
        if (ownDomain(viewer) !== domain) {
          throw refuse('DOMAIN_NOT_YOURS', `Only someone with a verified address at ${domain} can add it.`);
        }
      }
      const removed = before.filter((domain) => !wanted.includes(domain));
      if (removed.length > 0) {
        await tx
          .delete(workspaceDomains)
          .where(and(eq(workspaceDomains.workspaceId, scope.workspaceId), inArray(workspaceDomains.domain, removed)));
        // Open requests that came through a domain now off close with it: nobody approves through a door shut.
        const actor = actorRow(scope.actor);
        await tx
          .update(joinRequests)
          .set({
            status: 'declined',
            decidedByType: actor.type,
            decidedById: actor.id,
            decidedByMemberId: actor.memberId,
            decidedAt: sql`now()`,
            ...touched(scope),
          })
          .where(
            and(
              eq(joinRequests.workspaceId, scope.workspaceId),
              eq(joinRequests.status, 'open'),
              inArray(sql`split_part(${joinRequests.email}, '@', 2)`, removed),
            ),
          );
      }
      const by = touched(scope);
      for (const domain of added) {
        await tx
          .insert(workspaceDomains)
          .values({
            workspaceId: scope.workspaceId,
            domain,
            createdByType: by.updatedByType,
            createdById: by.updatedById,
            createdByMemberId: by.updatedByMemberId,
            ...by,
          })
          .onConflictDoNothing();
      }
      if (added.length > 0 || removed.length > 0) {
        await writeAudit(
          tx,
          scope.workspaceId,
          scope.actor,
          {
            action: 'workspace.domains_set',
            targetType: 'workspace',
            targetId: scope.workspaceId,
            before: { domains: before },
            after: { domains: await domainsOf(tx, scope.workspaceId) },
          },
          options.source,
        );
      }
      return domainsView(await domainsOf(tx, scope.workspaceId), viewer);
    },
    hooks,
  );
  return result;
}

/** The person's standing in one workspace: whether it is live, whether they are in it, and their latest request. */
async function standingIn(tx: WorkspaceTx, workspaceId: string, person: SessionPerson, domain: string) {
  const [workspace] = await tx
    .select({ name: workspaces.name, slug: workspaces.slug, deletedAt: workspaces.deletedAt })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId));
  // The domain is still on (the lookup ran before this transaction), the workspace live.
  const [on] = await tx
    .select({ domain: workspaceDomains.domain })
    .from(workspaceDomains)
    .where(and(eq(workspaceDomains.workspaceId, workspaceId), eq(workspaceDomains.domain, domain)));
  if (workspace === undefined || workspace.deletedAt !== null || on === undefined) return undefined;
  const [mine] = await tx
    .select({ id: members.id })
    .from(members)
    .where(and(eq(members.workspaceId, workspaceId), eq(members.userId, person.id), eq(members.status, 'active')));
  const [latest] = await tx
    .select({
      id: joinRequests.id,
      status: joinRequests.status,
      quiet: sql<boolean>`${joinRequests.decidedAt} > now() - make_interval(days => ${DECLINE_QUIET_DAYS})`,
    })
    .from(joinRequests)
    .where(and(eq(joinRequests.workspaceId, workspaceId), eq(joinRequests.userId, person.id)))
    .orderBy(desc(joinRequests.createdAt))
    .limit(1);
  // A decline reads as pending to the person for 30 days (AC-820): it never says no to them.
  const pending = latest !== undefined && (latest.status === 'open' || (latest.status === 'declined' && latest.quiet));
  return { name: workspace.name, slug: workspace.slug, isMember: mine !== undefined, pending };
}

/**
 * The workspaces the signed in person may ask to join (spec 0031, AC-819):
 * those with their verified email's domain on, that they aren't in, with
 * whether they already asked. None for an unverified or public address.
 */
export async function listJoinable(deps: { readonly db: Database }, person: SessionPerson): Promise<Joinable[]> {
  const domain = ownDomain(person);
  if (domain === undefined) return [];
  const entered = await enterDomainWorkspaces(deps, domain);
  const found: Joinable[] = [];
  for (const { workspaceId, scope } of entered) {
    const standing = await inWorkspace(scope, (tx) => standingIn(tx, workspaceId, person, domain));
    if (standing === undefined || standing.isMember) continue;
    found.push({ workspaceId, name: standing.name, state: standing.pending ? 'pending' : 'none' });
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

/** Who to tell about a new request: the workspace's active owners and admins, by name and address. */
export interface RequestNotice {
  readonly workspaceName: string;
  readonly slug: string;
  readonly requester: { readonly name: string; readonly email: string };
  readonly admins: readonly { readonly name: string; readonly email: string }[];
}

/**
 * Asks to join a workspace through its email domain (spec 0031, AC-819):
 * the person's verified email must be at a domain the workspace has on, and
 * they must not be in it (404 otherwise, the same for a workspace that
 * doesn't exist). One open request per person; asking again while one is
 * open (or declined within 30 days) answers pending and writes nothing.
 * Answers the workspace as `/join` shows it, and, for a new request, who to
 * email.
 */
export async function requestToJoin(
  deps: { readonly db: Database },
  person: SessionPerson,
  workspaceId: string,
  hooks: readonly AfterWrite[] = [],
  options: InviteWriteOptions = {},
): Promise<{ readonly joinable: Joinable; readonly notice?: RequestNotice }> {
  const id = checkId(workspaceId, WORKSPACE_NOT_FOUND);
  const domain = ownDomain(person);
  if (domain === undefined) throw refuse('NOT_FOUND', WORKSPACE_NOT_FOUND);
  const scope = await enterDomainWorkspace(deps, id, domain);
  if (scope === undefined) throw refuse('NOT_FOUND', WORKSPACE_NOT_FOUND);
  const { result } = await runWrite(
    scope,
    async ({ tx }) => {
      // One asker at a time per person and workspace, so two tabs make one request.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`join:${id}:${person.id}`}, 0))`);
      const standing = await standingIn(tx, id, person, domain);
      if (standing === undefined || standing.isMember) throw refuse('NOT_FOUND', WORKSPACE_NOT_FOUND);
      const joinable: Joinable = { workspaceId: id, name: standing.name, state: 'pending' };
      if (standing.pending) return { joinable };
      const requestId = newId();
      const email = person.email.trim().toLowerCase();
      const name = plainName(person.name, email);
      await tx.insert(joinRequests).values({
        workspaceId: id,
        id: requestId,
        userId: person.id,
        email,
        name,
        createdByType: 'system',
        updatedByType: 'system',
      });
      await writeAudit(
        tx,
        id,
        scope.actor,
        // The address stays in join_requests: the log names the request, never personal data it can't drop.
        { action: 'join_request.created', targetType: 'join_request', targetId: requestId },
        options.source,
      );
      const admins = await tx
        .select({ name: members.name, email: members.email })
        .from(members)
        .where(
          and(
            eq(members.workspaceId, id),
            eq(members.status, 'active'),
            inArray(
              sql`${members.role}::text`,
              Object.entries(ROLE_PERMISSIONS)
                .filter(([, granted]) => (granted as readonly string[]).includes('members.invite'))
                .map(([role]) => role),
            ),
          ),
        )
        .orderBy(asc(members.name))
        .limit(20);
      return {
        joinable,
        notice: {
          workspaceName: standing.name,
          slug: standing.slug,
          requester: { name, email },
          admins: admins.filter((admin) => admin.email !== ''),
        },
      };
    },
    hooks,
  );
  return result;
}

/** The workspace's open requests to join, oldest first (spec 0031, AC-820): holders of `members.invite` only. */
export async function listJoinRequests(scope: EngineScope): Promise<JoinRequestView[]> {
  checkInvites(scope);
  const rows = await inWorkspace(scope, (tx) =>
    tx
      .select({ id: joinRequests.id, name: joinRequests.name, email: joinRequests.email, at: joinRequests.createdAt })
      .from(joinRequests)
      .where(and(eq(joinRequests.workspaceId, scope.workspaceId), eq(joinRequests.status, 'open')))
      .orderBy(asc(joinRequests.createdAt), asc(joinRequests.id))
      .limit(REQUESTS_MAX),
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    requestedAt: new Date(row.at).toISOString(),
  }));
}

/** What a decision did, for the approval's email: whether they joined, and whom to tell where. */
export interface JoinDecision {
  readonly approved: boolean;
  readonly email: string;
  readonly name: string;
  readonly workspaceName: string;
  readonly slug: string;
  /**
   * Their link page's handle in the workspace (26 Oct 2026), made with the membership, for the approval email;
   * absent on a decline, for someone already in who has none, or when it couldn't be made yet.
   */
  readonly handle?: string;
}

/**
 * Approves or declines an open request to join (spec 0031, AC-820): needs
 * `members.invite`, as held now. Approving makes them an active member (a
 * seat, 409 `SEAT_LIMIT` without one; already in, nothing more), with their
 * directory row and a `members` outbox row; declining tells them nothing
 * (their page says pending for 30 days). One audit row. A request that isn't
 * open is 404.
 */
export async function decideJoinRequest(
  scope: EngineScope,
  input: { readonly requestId: string; readonly approve: boolean },
  hooks: readonly AfterWrite[] = [],
  options: InviteWriteOptions = {},
): Promise<JoinDecision> {
  checkInvites(scope);
  const requestId = checkId(input.requestId, REQUEST_NOT_FOUND);
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      await checkActingNow(tx, scope, 'member');
      const [request] = await tx
        .select({
          id: joinRequests.id,
          userId: joinRequests.userId,
          email: joinRequests.email,
          name: joinRequests.name,
        })
        .from(joinRequests)
        .where(
          and(
            eq(joinRequests.workspaceId, scope.workspaceId),
            eq(joinRequests.id, requestId),
            eq(joinRequests.status, 'open'),
          ),
        )
        .for('update');
      if (request === undefined) throw refuse('NOT_FOUND', REQUEST_NOT_FOUND);
      const [workspace] = await tx
        .select({ name: workspaces.name, slug: workspaces.slug })
        .from(workspaces)
        .where(eq(workspaces.id, scope.workspaceId));
      const by = actorRow(scope.actor);
      const decided = {
        decidedByType: by.type,
        decidedById: by.id,
        decidedByMemberId: by.memberId,
        decidedAt: sql`now()`,
        ...touched(scope),
      };
      const decision = {
        approved: input.approve,
        email: request.email,
        name: request.name,
        workspaceName: workspace?.name ?? '',
        slug: workspace?.slug ?? '',
      };
      if (!input.approve) {
        await tx
          .update(joinRequests)
          .set({ status: 'declined', ...decided })
          .where(and(eq(joinRequests.workspaceId, scope.workspaceId), eq(joinRequests.id, request.id)));
        await writeAudit(
          tx,
          scope.workspaceId,
          scope.actor,
          { action: 'join_request.declined', targetType: 'join_request', targetId: request.id },
          options.source,
        );
        return decision;
      }
      const [mine] = await tx
        .select({ id: members.id })
        .from(members)
        .where(
          and(
            eq(members.workspaceId, scope.workspaceId),
            eq(members.userId, request.userId),
            eq(members.status, 'active'),
          ),
        )
        .for('update');
      // Someone else here already holds the address: no second member with it.
      const [taken] = await tx
        .select({ id: members.id })
        .from(members)
        .where(
          and(
            eq(members.workspaceId, scope.workspaceId),
            eq(members.status, 'active'),
            sql`lower(${members.email}) = ${request.email}`,
            ...(mine === undefined ? [] : [notInArray(members.id, [mine.id])]),
          ),
        )
        .limit(1);
      if (taken !== undefined && mine === undefined) throw refuse('NOT_FOUND', REQUEST_NOT_FOUND);
      let memberId = mine?.id;
      if (memberId === undefined) {
        await checkSeats(tx, scope, 1);
        memberId = await addJoiner(
          tx,
          scope.workspaceId,
          { id: request.userId, name: request.name, email: request.email },
          'member',
        );
        context.record({ members: [memberId] });
        // An everyone delegation reaches them now (spec 0037, AC-1274).
        await recordJoinReach(context, scope.workspaceId, memberId);
      }
      // Their link page (26 Oct 2026): the one they hold here, or one made now. The approval email says where it is.
      const handle = await ensureLinkPage(tx, {
        userId: request.userId,
        workspaceId: scope.workspaceId,
        name: joinerName(undefined, request.name, request.email),
        email: request.email,
      });
      await tx
        .update(joinRequests)
        .set({ status: 'approved', memberId, ...decided })
        .where(and(eq(joinRequests.workspaceId, scope.workspaceId), eq(joinRequests.id, request.id)));
      await writeAudit(
        tx,
        scope.workspaceId,
        scope.actor,
        {
          action: 'join_request.approved',
          targetType: 'member',
          targetId: memberId,
          after: { role: 'member', requestId: request.id, ...(mine === undefined ? {} : { alreadyMember: true }) },
        },
        options.source,
      );
      return handle === undefined ? decision : { ...decision, handle };
    },
    hooks,
  );
  return result;
}
