// Partners (spec 0070, slice 2, AC-7010 to AC-7013): an outside product registered in the operator console, the
// OAuth 2.0 connect (authorization code with PKCE, S256 only) by which a workspace's owner links it to their
// workspace, Settings › Connected apps, and the partner API's first shapes under `/api/partner/v1`.
//
// The module list is closed (AC-7013): a partner may only ever be given a module named here.
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { Timestamp } from './values/attribute-values.ts';
import { Uuid } from './values/ids.ts';
import { WorkspaceScoped } from './workspaces.ts';

/** The modules a connection can switch on (AC-7013): link pages now; booking, forms and menus join later. */
export const PARTNER_MODULES = ['link_pages'] as const;
/** One module a partner may be given. */
export const PartnerModule = z.enum(PARTNER_MODULES, { error: 'Pick a module from the list.' });
/** One module a partner may be given. */
export type PartnerModule = z.infer<typeof PartnerModule>;

/** A module's name on the connect page and in Connected apps. */
export const PARTNER_MODULE_LABELS: Readonly<Record<PartnerModule, string>> = { link_pages: 'Link pages' };

/**
 * What any connection lets a partner do, whatever its modules (AC-7012): the connect page lists these first, then one
 * line per module ticked (`PARTNER_MODULE_POWERS`), so the list is exactly what it may do.
 */
export const PARTNER_BASE_POWERS: readonly string[] = ['Add and remove people in this workspace'];
/** What each module adds to that list (AC-7012). */
export const PARTNER_MODULE_POWERS: Readonly<Record<PartnerModule, string>> = {
  link_pages: 'Open Link pages for them, and manage each person’s link page and QR code',
};

/** A partner's public client id: `tfp_` and 22 base64url characters. */
export const PARTNER_CLIENT_ID = /^tfp_[A-Za-z0-9_-]{22}$/;
/** The longest `state` the connect takes back to the partner. */
export const PARTNER_STATE_MAX = 500;
/** How long a connect's one time code works, in seconds (AC-7011). */
export const PARTNER_CODE_SECONDS = 60;
/** How many partner API calls one connection may make a minute (AC-7025's limit, from slice 2 on). */
export const PARTNER_REQUESTS_A_MINUTE = 120;
/** How many token exchanges one partner may make a minute. */
export const PARTNER_TOKEN_REQUESTS_A_MINUTE = 30;
/** The largest partner logo, in bytes. */
export const PARTNER_LOGO_MAX_BYTES = 200 * 1024;
/** How many frame origins and redirect addresses a partner may register, each. */
export const PARTNER_ADDRESSES_MAX = 10;

/** The image types a logo may be. */
export const PARTNER_LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

/** A logo as the console uploads it: its type and its bytes as base64. */
export const PartnerLogoUpload = z.object({
  type: z.enum(PARTNER_LOGO_TYPES, { error: 'Use a PNG, JPEG or WebP logo.' }),
  // 200 KB as base64, with room for padding.
  data: z
    .string()
    .min(1)
    .max(Math.ceil((PARTNER_LOGO_MAX_BYTES * 4) / 3) + 4, 'Use a logo under 200 KB.'),
});
/** A logo as the console uploads it. */
export type PartnerLogoUpload = z.infer<typeof PartnerLogoUpload>;

/** A partner's name. */
const PartnerName = z.string().trim().min(1, 'Give the partner a name.').max(80, 'Keep the name under 80 characters.');
/** Frame origins as typed; the server checks each is an origin. */
const FrameOrigins = z
  .array(z.string().trim().max(200, 'Keep each address under 200 characters.'))
  .max(PARTNER_ADDRESSES_MAX, 'Add at most 10 addresses.');
/** Redirect addresses as typed; the server checks each is a full https address. */
const RedirectUris = z
  .array(z.string().trim().max(500, 'Keep each address under 500 characters.'))
  .min(1, 'Add the address that receives a connection.')
  .max(PARTNER_ADDRESSES_MAX, 'Add at most 10 addresses.');

/** One partner as the console shows it: never its secret, only its last four characters. */
export const PartnerView = z.object({
  id: Uuid,
  clientId: z.string(),
  name: z.string(),
  /** Our own address for its logo, when it has one. */
  logoUrl: z.string().optional(),
  frameOrigins: z.array(z.string()),
  redirectUris: z.array(z.string()),
  secretHint: z.string(),
  createdAt: Timestamp,
  secretReplacedAt: Timestamp.optional(),
});
/** One partner as the console shows it. */
export type PartnerView = z.infer<typeof PartnerView>;

/** Every partner, newest first. */
export const PartnerList = z.object({ partners: z.array(PartnerView) });
/** Every partner. */
export type PartnerList = z.infer<typeof PartnerList>;

/** Registers a partner (AC-7010). */
export const RegisterPartnerInput = z.object({
  name: PartnerName,
  logo: PartnerLogoUpload.optional(),
  frameOrigins: FrameOrigins,
  redirectUris: RedirectUris,
});
/** Registers a partner. */
export type RegisterPartnerInput = z.infer<typeof RegisterPartnerInput>;

/** A partner with its whole secret: answered once, by the register or the replace that made the secret. */
export const PartnerWithSecret = z.object({ partner: PartnerView, secret: z.string() });
/** A partner with its whole secret. */
export type PartnerWithSecret = z.infer<typeof PartnerWithSecret>;

/** Changes a partner: only the fields given; `logo: null` takes the logo away. */
export const UpdatePartnerInput = z.object({
  partnerId: Uuid,
  name: PartnerName.optional(),
  logo: PartnerLogoUpload.nullable().optional(),
  frameOrigins: FrameOrigins.optional(),
  redirectUris: RedirectUris.optional(),
});
/** Changes a partner. */
export type UpdatePartnerInput = z.infer<typeof UpdatePartnerInput>;

/** Names one partner. */
export const PartnerRefInput = z.object({ partnerId: Uuid });
/** Names one partner. */
export type PartnerRefInput = z.infer<typeof PartnerRefInput>;

/**
 * The OAuth request the partner sent to `/oauth/partner/authorize`, as the connect page read it from its address.
 * Kept as plain text here: the server checks every field and words what is wrong, so the page can say it.
 */
export const PartnerConnectRequest = z.object({
  clientId: z.string().max(100),
  redirectUri: z.string().max(500),
  state: z.string().max(PARTNER_STATE_MAX + 1),
  codeChallenge: z.string().max(200),
  codeChallengeMethod: z.string().max(20),
  responseType: z.string().max(20),
});
/** The OAuth request the partner sent. */
export type PartnerConnectRequest = z.infer<typeof PartnerConnectRequest>;

/** One workspace the person may connect: one they own. */
export const ConnectableWorkspace = z.object({
  slug: z.string(),
  name: z.string(),
  /** Whether this partner is already connected to it: approving again replaces that connection's token. */
  connected: z.boolean(),
});
/** One workspace the person may connect. */
export type ConnectableWorkspace = z.infer<typeof ConnectableWorkspace>;

/** What the connect page shows (AC-7012): the partner, the modules it may ask for, and the person's own workspaces. */
export const PartnerConnectOffer = z.object({
  partner: z.object({ name: z.string(), logoUrl: z.string().optional() }),
  modules: z.array(PartnerModule),
  /** The workspaces the person owns, oldest first. */
  workspaces: z.array(ConnectableWorkspace),
  /** How many other workspaces they're in, which only their owners can connect. */
  otherWorkspaces: z.number().int().min(0),
});
/** What the connect page shows. */
export type PartnerConnectOffer = z.infer<typeof PartnerConnectOffer>;

/** The owner's approval (AC-7011): the request again, the workspace, and the modules ticked. */
export const ApprovePartnerConnectInput = WorkspaceScoped.extend({
  request: PartnerConnectRequest,
  modules: z.array(PartnerModule).min(1, 'Tick at least one module.').max(PARTNER_MODULES.length),
  mutationId: Uuid,
});
/** The owner's approval. */
export type ApprovePartnerConnectInput = z.infer<typeof ApprovePartnerConnectInput>;

/** Where the browser goes next: the partner's registered address, with the code and state, or the refusal. */
export const PartnerConnectRedirect = z.object({ redirectTo: z.string() });
/** Where the browser goes next. */
export type PartnerConnectRedirect = z.infer<typeof PartnerConnectRedirect>;

/** One connection as Settings › Connected apps lists it (AC-7013). */
export const ConnectedApp = z.object({
  id: Uuid,
  partner: z.object({ name: z.string(), logoUrl: z.string().optional() }),
  modules: z.array(PartnerModule),
  connectedAt: Timestamp,
  /** Who approved it, by name; absent once they left the workspace. */
  approvedBy: z.string().optional(),
  lastCallAt: Timestamp.optional(),
});
/** One connection as Connected apps lists it. */
export type ConnectedApp = z.infer<typeof ConnectedApp>;

/** The workspace's live connections, newest first. */
export const ConnectedAppList = z.object({ apps: z.array(ConnectedApp) });
/** The workspace's live connections. */
export type ConnectedAppList = z.infer<typeof ConnectedAppList>;

/** Changes a connection's modules. */
export const SetConnectedAppModulesInput = WorkspaceScoped.extend({
  connectionId: Uuid,
  modules: z
    .array(PartnerModule)
    .min(1, 'Keep at least one module, or disconnect the app.')
    .max(PARTNER_MODULES.length),
  mutationId: Uuid,
});
/** Changes a connection's modules. */
export type SetConnectedAppModulesInput = z.infer<typeof SetConnectedAppModulesInput>;

/** Ends a connection: its token stops at once. */
export const DisconnectAppInput = WorkspaceScoped.extend({ connectionId: Uuid, mutationId: Uuid });
/** Ends a connection. */
export type DisconnectAppInput = z.infer<typeof DisconnectAppInput>;

/**
 * The token exchange's body (`POST /api/partner/v1/token`, form encoded or JSON): OAuth's own field names. The client
 * id and secret come here or as HTTP Basic.
 */
export const PartnerTokenRequest = z.object({
  grant_type: z.literal('authorization_code', { error: 'Send grant_type=authorization_code.' }),
  code: z.string().min(1).max(200),
  redirect_uri: z.string().min(1).max(500),
  code_verifier: z
    .string()
    .regex(/^[A-Za-z0-9._~-]{43,128}$/, 'Send the PKCE code_verifier: 43 to 128 unreserved characters.'),
  client_id: z.string().max(100).optional(),
  client_secret: z.string().max(200).optional(),
});
/** The token exchange's body. */
export type PartnerTokenRequest = z.infer<typeof PartnerTokenRequest>;

/** A connection as the partner reads it. */
export const PartnerConnectionView = z.object({
  id: Uuid,
  workspace: z.object({ id: Uuid, name: z.string() }),
  modules: z.array(PartnerModule),
  connectedAt: Timestamp,
});
/** A connection as the partner reads it. */
export type PartnerConnectionView = z.infer<typeof PartnerConnectionView>;

/** The token exchange's answer: the connection and its access token, which is never shown again. */
export const PartnerTokenAnswer = z.object({
  access_token: z.string(),
  token_type: z.literal('Bearer'),
  connection_id: Uuid,
  connection: PartnerConnectionView,
});
/** The token exchange's answer. */
export type PartnerTokenAnswer = z.infer<typeof PartnerTokenAnswer>;

/**
 * The connect, before any workspace (`offer`, `deny`) and inside the one chosen (`approve`, its owner only). A request
 * naming an unknown partner or an address it didn't register is `INPUT_INVALID` and never sends the browser anywhere.
 */
export const partnerConnectContract = {
  offer: oc.input(PartnerConnectRequest).output(PartnerConnectOffer),
  approve: oc.input(ApprovePartnerConnectInput).output(PartnerConnectRedirect),
  deny: oc.input(PartnerConnectRequest).output(PartnerConnectRedirect),
};

/** Settings › Connected apps (AC-7013): owners only (`connected_apps.manage`). */
export const connectedAppsContract = {
  list: oc.input(WorkspaceScoped).output(ConnectedAppList),
  setModules: oc.input(SetConnectedAppModulesInput).output(ConnectedApp),
  disconnect: oc.input(DisconnectAppInput).output(z.object({ id: Uuid })),
};
