// The OAuth connect (spec 0070, AC-7011, AC-7012): authorization code with PKCE, S256 only, `state` required.
//
// `checkConnectRequest` is the one check of what a partner sent: a client id we registered, a redirect address equal
// character for character to one it registered, `response_type=code`, an S256 challenge and a state. Until it passes,
// nothing sends the browser anywhere, so no address of anyone's choosing is ever followed (no open redirect).
//
// `partnerConnectOffer` shows the person the partner and the workspaces they own (each entered through the door);
// `approvePartnerConnect` is the owner's approval inside one workspace (`connected_apps.manage`, owners only): it
// stores a one time code (its SHA-256, the challenge, the redirect address and the modules, 60 seconds) and answers
// the registered address with the code and the state. `denyPartnerConnect` answers the address with
// `error=access_denied`. The partner's server swaps the code for a connection in `exchange.ts`.
import {
  PARTNER_CODE_SECONDS,
  PARTNER_MODULES,
  PARTNER_STATE_MAX,
  type ConnectableWorkspace,
  type PartnerConnectOffer,
  type PartnerConnectRedirect,
  type PartnerConnectRequest,
  type PartnerModule,
} from '@crm/contracts';
import { schema, type DirectoryWorkspace, type IdentityStore, type PartnerIdentity, type PartnerRow } from '@crm/db';
import { and, eq, isNull, lt, sql } from 'drizzle-orm';
import { requirePermission } from '../access/check.ts';
import { enterWorkspace, type DoorDeps, type DoorSession } from '../access/door.ts';
import type { EngineScope } from '../access/mint.ts';
import { inWorkspace } from '../access/run.ts';
import { newId } from '../engine/ids.ts';
import { refuse } from '../engine/refusals.ts';
import { partnerLogoPath } from './addresses.ts';
import { isClientId, isS256Challenge, newPartnerTokenSecret, partnerCode, partnerTokenHash } from './tokens.ts';

const { partnerCodes, partnerConnections } = schema;

/** The most workspaces the connect page checks for a person: more than anyone owns. */
const WORKSPACES_MAX = 50;
/** How many of them are entered at once. */
const ENTER_AT_ONCE = 5;

/** What the connect needs of the registry: one partner by its client id. */
export interface ConnectPartners {
  readonly partners: Pick<PartnerIdentity, 'partnerByClientId'>;
}

const UNKNOWN_APP = 'This connect link names an app Timefix doesn’t know. Go back to the app and try again.';

/** A visible character's string, as `state` must be (RFC 6749 appendix A: %x20-7E). */
const VISIBLE = /^[\x20-\x7e]+$/;

/**
 * The partner a connect request names, once every part of it checks out; a refusal in plain words otherwise
 * (`NOT_FOUND` for an unknown app, `CONFIG_INVALID` for anything else), which the page shows and never follows.
 */
export async function checkConnectRequest(deps: ConnectPartners, request: PartnerConnectRequest): Promise<PartnerRow> {
  if (!isClientId(request.clientId)) throw refuse('NOT_FOUND', UNKNOWN_APP);
  const partner = await deps.partners.partnerByClientId(request.clientId);
  if (partner === undefined) throw refuse('NOT_FOUND', UNKNOWN_APP);
  // Exactly as registered: no prefix match, no normalising, so no other address can ride on a registered one.
  if (!partner.redirectUris.includes(request.redirectUri)) {
    throw refuse(
      'CONFIG_INVALID',
      `This link would send you back to an address ${partner.name} didn’t register with Timefix, so it was stopped.`,
    );
  }
  if (request.responseType !== 'code') {
    throw refuse('CONFIG_INVALID', `${partner.name} asked to connect in a way Timefix doesn’t take (response_type).`);
  }
  // S256 only: a `plain` challenge, or none, is a downgrade a stolen code could ride on.
  if (request.codeChallengeMethod !== 'S256' || !isS256Challenge(request.codeChallenge)) {
    throw refuse('CONFIG_INVALID', `${partner.name} asked to connect without a PKCE S256 challenge.`);
  }
  if (request.state.length === 0 || request.state.length > PARTNER_STATE_MAX || !VISIBLE.test(request.state)) {
    throw refuse('CONFIG_INVALID', `${partner.name} asked to connect without a valid state.`);
  }
  // A partner never sees its own row's hash past this point.
  return {
    id: partner.id,
    clientId: partner.clientId,
    name: partner.name,
    ...(partner.logoVersion === undefined ? {} : { logoVersion: partner.logoVersion }),
    frameOrigins: partner.frameOrigins,
    redirectUris: partner.redirectUris,
    secretHint: partner.secretHint,
    createdAt: partner.createdAt,
    updatedAt: partner.updatedAt,
    ...(partner.secretReplacedAt === undefined ? {} : { secretReplacedAt: partner.secretReplacedAt }),
  };
}

/** The partner's registered address with these parameters added, its own query kept. */
function backTo(redirectUri: string, params: Readonly<Record<string, string>>): string {
  const url = new URL(redirectUri);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  return url.toString();
}

/** What the connect page needs to enter each of the person's workspaces. */
export interface ConnectOfferDeps extends ConnectPartners {
  readonly door: DoorDeps;
  readonly identity: Pick<IdentityStore, 'workspacesOf'>;
}

/**
 * What the connect page shows (AC-7012): the partner's name and logo, the modules it may be given, and the workspaces
 * the person owns (each entered through the door, so a removed member or a workspace whose sign in rules they don't
 * meet is left out), with whether this partner is already connected to each.
 */
export async function partnerConnectOffer(
  deps: ConnectOfferDeps,
  input: { readonly userId: string; readonly session: DoorSession; readonly request: PartnerConnectRequest },
): Promise<PartnerConnectOffer> {
  const partner = await checkConnectRequest(deps, input.request);
  const listed: readonly DirectoryWorkspace[] = (await deps.identity.workspacesOf(input.userId)).slice(
    0,
    WORKSPACES_MAX,
  );
  const check = async (
    workspace: DirectoryWorkspace,
  ): Promise<
    { readonly owned: false } | { readonly owned: true; readonly workspace: ConnectableWorkspace } | undefined
  > => {
    let scope: EngineScope;
    try {
      scope = await enterWorkspace(deps.door, { userId: input.userId, slug: workspace.slug, session: input.session });
    } catch {
      return undefined;
    }
    if (!scope.access.permissions.includes('connected_apps.manage')) return { owned: false };
    const live = await inWorkspace(scope, (tx) =>
      tx
        .select({ id: partnerConnections.id })
        .from(partnerConnections)
        .where(and(eq(partnerConnections.partnerId, partner.id), isNull(partnerConnections.disconnectedAt)))
        .limit(1),
    );
    return { owned: true, workspace: { slug: workspace.slug, name: workspace.name, connected: live.length > 0 } };
  };
  // A few at a time: each entry holds a pooled connection while it reads.
  const checked: (
    { readonly owned: false } | { readonly owned: true; readonly workspace: ConnectableWorkspace } | undefined
  )[] = [];
  for (let at = 0; at < listed.length; at += ENTER_AT_ONCE) {
    checked.push(...(await Promise.all(listed.slice(at, at + ENTER_AT_ONCE).map(check))));
  }
  const workspaces = checked.flatMap((each) => (each?.owned === true ? [each.workspace] : []));
  return {
    partner: {
      name: partner.name,
      ...(partner.logoVersion === undefined ? {} : { logoUrl: partnerLogoPath(partner.clientId, partner.logoVersion) }),
    },
    modules: [...PARTNER_MODULES],
    workspaces,
    otherWorkspaces: checked.filter((each) => each !== undefined && !each.owned).length,
  };
}

/** The modules ticked, once each, in catalog order. */
function modulesOf(ticked: readonly PartnerModule[]): PartnerModule[] {
  const chosen = PARTNER_MODULES.filter((module) => ticked.includes(module));
  if (chosen.length === 0) throw refuse('CONFIG_INVALID', 'Tick at least one module.');
  return chosen;
}

/**
 * The owner's approval (AC-7011), inside the workspace the door let them into: `connected_apps.manage` (owners only)
 * first, then the request checked again from the start, then one code stored: its SHA-256, the partner, the redirect
 * address and challenge it was asked with, the modules and the approver, good once for 60 seconds. Codes older than
 * a day go in the same transaction. Answers the registered address with `code` and `state`.
 */
export async function approvePartnerConnect(
  scope: EngineScope,
  deps: ConnectPartners,
  input: { readonly request: PartnerConnectRequest; readonly modules: readonly PartnerModule[] },
): Promise<PartnerConnectRedirect> {
  requirePermission(scope, 'connected_apps.manage');
  const { principal } = scope.access;
  if (principal.kind !== 'member') throw refuse('FORBIDDEN', 'Only a workspace owner can connect an app.');
  const partner = await checkConnectRequest(deps, input.request);
  const modules = modulesOf(input.modules);
  const id = newId();
  const secret = newPartnerTokenSecret();
  await inWorkspace(scope, async (tx) => {
    await tx.delete(partnerCodes).where(lt(partnerCodes.expiresAt, sql`now() - interval '1 day'`));
    await tx.insert(partnerCodes).values({
      workspaceId: scope.workspaceId,
      id,
      partnerId: partner.id,
      codeHash: partnerTokenHash(secret),
      codeChallenge: input.request.codeChallenge,
      redirectUri: input.request.redirectUri,
      modules,
      approvedByMemberId: principal.memberId,
      expiresAt: sql`now() + make_interval(secs => ${PARTNER_CODE_SECONDS})`,
    });
  });
  const code = partnerCode({ workspaceId: scope.workspaceId, id, secret });
  return { redirectTo: backTo(input.request.redirectUri, { code, state: input.request.state }) };
}

/**
 * The person said no (or Cancel): the registered address with `error=access_denied` and the state, once the request
 * checks out. Nothing is stored.
 */
export async function denyPartnerConnect(
  deps: ConnectPartners,
  request: PartnerConnectRequest,
): Promise<PartnerConnectRedirect> {
  await checkConnectRequest(deps, request);
  return { redirectTo: backTo(request.redirectUri, { error: 'access_denied', state: request.state }) };
}
