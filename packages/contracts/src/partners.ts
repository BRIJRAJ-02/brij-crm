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
  /** A sandbox partner (AC-7035): its connections are test ones, never billed, and can be wiped in one go. */
  isTest: z.boolean(),
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
  /** A sandbox partner (AC-7035): its connections are made as test ones. */
  isTest: z.boolean().optional(),
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
  /** Marks it a sandbox partner, or a live one (AC-7035): only connections made from now on take the mark. */
  isTest: z.boolean().optional(),
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
  /** Made by a sandbox partner (AC-7035): marked as a test, never billed. */
  isTest: z.boolean(),
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
  /** Made by a sandbox partner (AC-7035). */
  isTest: z.boolean(),
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
 * A partner's own id for a person (spec 0070, AC-7020): 1 to 128 URL safe characters, as it sits in the address
 * `/connections/{id}/members/{externalId}`. The same id is always the same person.
 */
export const PARTNER_EXTERNAL_ID = /^[A-Za-z0-9._~:@+=|-]{1,128}$/;
/** A partner's own id for a person. */
export const PartnerExternalId = z
  .string()
  .regex(PARTNER_EXTERNAL_ID, 'Use 1 to 128 letters, digits or . _ ~ : @ + = | - for the external id.');
/** A partner's own id for a person. */
export type PartnerExternalId = z.infer<typeof PartnerExternalId>;

/** The roles a partner may give (AC-7024): never owner. */
export const PARTNER_MEMBER_ROLES = ['admin', 'member'] as const;
/** A role a partner may give. */
export const PartnerMemberRole = z.enum(PARTNER_MEMBER_ROLES, { error: 'Use admin or member for the role.' });
/** A role a partner may give. */
export type PartnerMemberRole = z.infer<typeof PartnerMemberRole>;

/** `PUT /connections/{id}/members/{externalId}`'s body (AC-7020): who the person is and their role. */
export const PartnerMemberInput = z.strictObject({
  email: z.email('Enter a valid email address.').max(254),
  name: z
    .string()
    .trim()
    .min(1, 'Add a name.')
    .max(80, 'Use at most 80 characters for the name.')
    // One line, no control characters (it is the link page's name and History's).
    // eslint-disable-next-line no-control-regex
    .regex(/^[^\u0000-\u001f\u007f-\u009f\u2028\u2029]+$/, 'Use a name on one line.'),
  role: PartnerMemberRole,
});
/** `PUT /connections/{id}/members/{externalId}`'s body. */
export type PartnerMemberInput = z.infer<typeof PartnerMemberInput>;

/**
 * A managed member as the partner reads them (AC-7020): the partner's id for them, their member id, name, email and
 * role in Timefix (`owner` when the workspace's owner made them one, which the partner can't change, AC-7024), and
 * their link page's handle while they have one.
 */
export const PartnerMemberView = z.object({
  externalId: PartnerExternalId,
  memberId: Uuid,
  name: z.string(),
  email: z.string(),
  role: z.enum(['owner', 'admin', 'member', 'guest']),
  handle: z.string().optional(),
  addedAt: Timestamp,
});
/** A managed member as the partner reads them. */
export type PartnerMemberView = z.infer<typeof PartnerMemberView>;

/** `GET /connections/{id}/members`: the partner's people still in the workspace, oldest first (at most 1,000). */
export const PartnerMemberList = z.object({ members: z.array(PartnerMemberView) });
/** The partner's people still in the workspace. */
export type PartnerMemberList = z.infer<typeof PartnerMemberList>;

/** The most people one partner's list answers. */
export const PARTNER_MEMBERS_LIST_MAX = 1000;

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

// Slice 4: embedded screens (AC-7030 to AC-7033).

/** The screens a launch may open (AC-7030), each in one module. */
export const PARTNER_SCREENS = ['link_pages.mine', 'link_pages.team'] as const;
/** A screen a launch may open. */
export const PartnerScreen = z.enum(PARTNER_SCREENS, {
  error: 'Use link_pages.mine or link_pages.team for the screen.',
});
/** A screen a launch may open. */
export type PartnerScreen = z.infer<typeof PartnerScreen>;

/** The module each screen belongs to: a connection without it can't open the screen. */
export const PARTNER_SCREEN_MODULE: Readonly<Record<PartnerScreen, PartnerModule>> = {
  'link_pages.mine': 'link_pages',
  'link_pages.team': 'link_pages',
};

/** How long a launch's one time address works (AC-7030). */
export const PARTNER_LAUNCH_SECONDS = 60;
/** How long an embedded session lasts (AC-7031): it is never extended. */
export const EMBED_SESSION_HOURS = 12;
/** The light or dark look a partner may ask for; absent, the person's system decides. */
export const EmbedTheme = z.enum(['light', 'dark'], { error: 'Use light or dark for the theme.' });
/** The light or dark look a partner may ask for. */
export type EmbedTheme = z.infer<typeof EmbedTheme>;

/** `POST /connections/{id}/launch`'s body (AC-7030): whom to open it for, which screen, and in which look. */
export const PartnerLaunchInput = z.strictObject({
  externalId: PartnerExternalId,
  screen: PartnerScreen,
  theme: EmbedTheme.optional(),
});
/** `POST /connections/{id}/launch`'s body. */
export type PartnerLaunchInput = z.infer<typeof PartnerLaunchInput>;

/** The launch's answer: the one time address to put in the frame's `src`, and when it stops working. */
export const PartnerLaunchAnswer = z.object({ url: z.string(), expiresAt: Timestamp });
/** The launch's answer. */
export type PartnerLaunchAnswer = z.infer<typeof PartnerLaunchAnswer>;

/** A launch's one time code as the frame hands it over: its shape is checked by the server. */
export const EmbedStartInput = z.object({ code: z.string().min(1).max(300) });
/** A launch's one time code. */
export type EmbedStartInput = z.infer<typeof EmbedStartInput>;

/**
 * What an embedded session opens (AC-7031, AC-7032): the workspace (its address names it to every procedure), the
 * partner (whose frame origins alone hear the frame's height), the screen it was launched for and its look, and who
 * the person is. `canManageTeam` says whether Team pages may be drawn.
 */
export const EmbedSessionView = z.object({
  workspace: z.string(),
  workspaceName: z.string(),
  partner: z.object({ clientId: z.string(), name: z.string() }),
  frameOrigins: z.array(z.string()),
  /** The screen the launch asked for: only `start` answers it; the frame's own address keeps it after that. */
  screen: PartnerScreen.optional(),
  theme: EmbedTheme.optional(),
  person: z.object({ name: z.string() }),
  canManageTeam: z.boolean(),
  expiresAt: Timestamp,
});
/** What an embedded session opens. */
export type EmbedSessionView = z.infer<typeof EmbedSessionView>;

/**
 * The embedded frame's own calls (AC-7031): `start` redeems a launch's one time code (once, within 60 seconds) and
 * sets the embedded session's cookie; `session` reads what that session opens. Both take no workspace: the session
 * names it.
 */
export const embedContract = {
  start: oc.input(EmbedStartInput).output(EmbedSessionView),
  session: oc.output(EmbedSessionView),
};

/** The console's wipe of a sandbox partner's test connections (AC-7035): how many it ended. */
export const WipedTestConnections = z.object({ wiped: z.number().int().min(0) });
/** How many test connections a wipe ended. */
export type WipedTestConnections = z.infer<typeof WipedTestConnections>;
