// Settings › Connected apps (spec 0070, AC-7013), and a partner's read of its own connection. The owner's side needs
// `connected_apps.manage` (owners only): the live connections with their modules, when each connected, who approved
// it and the partner's last call; a change of modules; and Disconnect, after which the connection's token is refused
// by the door at once (it reads `disconnected_at` on every call). Each change writes its History row in the same
// transaction. The partner's side (`readPartnerConnection`) takes only the scope `enterAsPartner` minted.
import {
  PARTNER_MODULES,
  type ConnectedApp,
  type ConnectedAppList,
  type PartnerConnectionView,
  type PartnerModule,
} from '@crm/contracts';
import { schema, type PartnerIdentity, type WorkspaceTx } from '@crm/db';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { requirePermission } from '../access/check.ts';
import type { EngineScope } from '../access/mint.ts';
import { inWorkspace } from '../access/run.ts';
import { isUuid } from '../engine/ids.ts';
import { refuse } from '../engine/refusals.ts';
import { writeAudit, type AuditSource } from '../members/audit.ts';
import { partnerLogoPath } from './addresses.ts';

const { members, partnerConnections, workspaces } = schema;

/** What Connected apps needs of the registry: each partner's name and logo. */
export interface ConnectedAppsDeps {
  readonly partners: Pick<PartnerIdentity, 'partnerById'>;
}

/** The most connections the list shows: more than any workspace has. */
const LIST_MAX = 100;

const UNKNOWN = 'That app isn’t connected to this workspace.';

/** Modules as stored, kept to the catalog. */
const modulesOf = (stored: readonly string[]): PartnerModule[] =>
  PARTNER_MODULES.filter((module) => stored.includes(module));

/** A partner's name and logo by id, read once each. */
async function partnerFaces(deps: ConnectedAppsDeps, ids: readonly string[]) {
  const unique = [...new Set(ids)];
  const rows = await Promise.all(unique.map((id) => deps.partners.partnerById(id)));
  return new Map(
    rows.flatMap((row) =>
      row === undefined
        ? []
        : [
            [
              row.id,
              {
                name: row.name,
                ...(row.logoVersion === undefined ? {} : { logoUrl: partnerLogoPath(row.clientId, row.logoVersion) }),
              },
            ] as const,
          ],
    ),
  );
}

/** The connection rows the list shows, with the approver's name while they're a member. */
async function liveRows(tx: WorkspaceTx, connectionId?: string) {
  return tx
    .select({
      id: partnerConnections.id,
      partnerId: partnerConnections.partnerId,
      modules: partnerConnections.modules,
      createdAt: partnerConnections.createdAt,
      lastCallAt: partnerConnections.lastCallAt,
      isTest: partnerConnections.isTest,
      approvedBy: members.name,
      approvedByStatus: members.status,
    })
    .from(partnerConnections)
    .leftJoin(
      members,
      and(
        eq(members.workspaceId, partnerConnections.workspaceId),
        eq(members.id, partnerConnections.approvedByMemberId),
      ),
    )
    .where(
      and(
        isNull(partnerConnections.disconnectedAt),
        ...(connectionId === undefined ? [] : [eq(partnerConnections.id, connectionId)]),
      ),
    )
    .orderBy(desc(partnerConnections.createdAt))
    .limit(LIST_MAX);
}

type LiveRow = Awaited<ReturnType<typeof liveRows>>[number];

function toConnectedApp(row: LiveRow, faces: Awaited<ReturnType<typeof partnerFaces>>): ConnectedApp {
  return {
    id: row.id,
    partner: faces.get(row.partnerId) ?? { name: 'An app' },
    modules: modulesOf(row.modules),
    connectedAt: new Date(row.createdAt).toISOString(),
    ...(row.approvedBy !== null && row.approvedByStatus === 'active' ? { approvedBy: row.approvedBy } : {}),
    ...(row.lastCallAt === null ? {} : { lastCallAt: new Date(row.lastCallAt).toISOString() }),
    isTest: row.isTest,
  };
}

/** The member the caller is, or a refusal: only a person connects or disconnects an app. */
function me(scope: EngineScope): string {
  const { principal } = scope.access;
  if (principal.kind !== 'member') throw refuse('FORBIDDEN', 'Only a workspace owner can change connected apps.');
  return principal.memberId;
}

/** The workspace's live connections, newest first. */
export async function listConnectedApps(scope: EngineScope, deps: ConnectedAppsDeps): Promise<ConnectedAppList> {
  requirePermission(scope, 'connected_apps.manage');
  const rows = await inWorkspace(scope, (tx) => liveRows(tx));
  const faces = await partnerFaces(
    deps,
    rows.map((row) => row.partnerId),
  );
  return { apps: rows.map((row) => toConnectedApp(row, faces)) };
}

/** Changes what a connection may use (AC-7013). The same modules again change nothing and write no row. */
export async function setConnectedAppModules(
  scope: EngineScope,
  deps: ConnectedAppsDeps,
  input: { readonly connectionId: string; readonly modules: readonly PartnerModule[] },
  source: AuditSource = {},
): Promise<ConnectedApp> {
  requirePermission(scope, 'connected_apps.manage');
  me(scope);
  if (!isUuid(input.connectionId)) throw refuse('NOT_FOUND', UNKNOWN);
  const modules = PARTNER_MODULES.filter((module) => input.modules.includes(module));
  if (modules.length === 0) throw refuse('CONFIG_INVALID', 'Keep at least one module, or disconnect the app.');
  const row = await inWorkspace(scope, async (tx) => {
    const [current] = await tx
      .select({ modules: partnerConnections.modules, partnerId: partnerConnections.partnerId })
      .from(partnerConnections)
      .where(and(eq(partnerConnections.id, input.connectionId), isNull(partnerConnections.disconnectedAt)))
      .for('update');
    if (current === undefined) throw refuse('NOT_FOUND', UNKNOWN);
    const before = modulesOf(current.modules);
    if (before.length !== modules.length || before.some((module) => !modules.includes(module))) {
      await tx
        .update(partnerConnections)
        .set({ modules, updatedAt: sql`now()` })
        .where(eq(partnerConnections.id, input.connectionId));
      const name = (await deps.partners.partnerById(current.partnerId))?.name ?? 'An app';
      await writeAudit(
        tx,
        scope.workspaceId,
        scope.actor,
        {
          action: 'partner.modules_changed',
          targetType: 'workspace',
          targetId: scope.workspaceId,
          before: { modules: before },
          after: { name, modules },
        },
        source,
      );
    }
    const [read] = await liveRows(tx, input.connectionId);
    if (read === undefined) throw new Error('A connection just changed could not be read back.');
    return read;
  });
  return toConnectedApp(row, await partnerFaces(deps, [row.partnerId]));
}

/**
 * Ends a connection (AC-7013): the door refuses its token from this commit on. Slice 4 also ends every embedded
 * session for it here. Disconnecting one already ended is `NOT_FOUND`, as an unknown one.
 */
export async function disconnectApp(
  scope: EngineScope,
  deps: ConnectedAppsDeps,
  input: { readonly connectionId: string },
  source: AuditSource = {},
): Promise<{ readonly id: string }> {
  requirePermission(scope, 'connected_apps.manage');
  const caller = me(scope);
  if (!isUuid(input.connectionId)) throw refuse('NOT_FOUND', UNKNOWN);
  return inWorkspace(scope, async (tx) => {
    const [ended] = await tx
      .update(partnerConnections)
      .set({ disconnectedAt: sql`now()`, disconnectedByMemberId: caller, updatedAt: sql`now()` })
      .where(and(eq(partnerConnections.id, input.connectionId), isNull(partnerConnections.disconnectedAt)))
      .returning({ partnerId: partnerConnections.partnerId, modules: partnerConnections.modules });
    if (ended === undefined) throw refuse('NOT_FOUND', UNKNOWN);
    const name = (await deps.partners.partnerById(ended.partnerId))?.name ?? 'An app';
    await writeAudit(
      tx,
      scope.workspaceId,
      scope.actor,
      {
        action: 'partner.disconnected',
        targetType: 'workspace',
        targetId: scope.workspaceId,
        after: { name, modules: modulesOf(ended.modules) },
      },
      source,
    );
    return { id: input.connectionId };
  });
}

/**
 * A partner's read of its own connection (`GET /api/partner/v1/connections/{id}`): only the scope `enterAsPartner`
 * minted, and only the connection it names; any other id is `NOT_FOUND`, as one that doesn't exist.
 */
export async function readPartnerConnection(
  scope: EngineScope,
  input: { readonly connectionId: string },
): Promise<PartnerConnectionView> {
  const { principal } = scope.access;
  if (principal.kind !== 'partner') throw refuse('FORBIDDEN', 'Only a partner’s own connection reads this.');
  if (principal.connectionId !== input.connectionId) throw refuse('NOT_FOUND', 'There is no such connection.');
  const [row] = await inWorkspace(scope, (tx) =>
    tx
      .select({
        modules: partnerConnections.modules,
        createdAt: partnerConnections.createdAt,
        isTest: partnerConnections.isTest,
        workspaceName: workspaces.name,
      })
      .from(partnerConnections)
      .innerJoin(workspaces, eq(workspaces.id, partnerConnections.workspaceId))
      .where(and(eq(partnerConnections.id, principal.connectionId), isNull(partnerConnections.disconnectedAt)))
      .limit(1),
  );
  if (row === undefined) throw refuse('NOT_FOUND', 'There is no such connection.');
  return {
    id: principal.connectionId,
    workspace: { id: scope.workspaceId, name: row.workspaceName },
    modules: modulesOf(row.modules),
    connectedAt: new Date(row.createdAt).toISOString(),
    isTest: row.isTest,
  };
}
