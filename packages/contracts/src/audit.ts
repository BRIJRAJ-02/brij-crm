// The audit log as Settings › History › Workspace changes reads it (spec 0046):
// `audit.list`, a page of the workspace's audit rows, newest first, behind
// `audit.read` (owners and admins). Every entry is resolved on the server into
// one strict variant per action: who did it, what it was done to, the few
// params its sentence needs, and the changed fields as typed values. The
// browser never receives a raw `before` or `after`, an IP or a request id, and
// a record a booking was linked to is never named or sent (it may be hidden
// from the reader).
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { Role } from './access.ts';
import { AUDIT_KIND_NAMES, AUDIT_PAGE } from './audit-kinds.ts';
import { Uuid } from './values/ids.ts';
import { WorkspaceScoped } from './workspaces.ts';

export {
  AUDIT_KIND_NAMES,
  AUDIT_KINDS,
  AUDIT_NOT_LISTED,
  AUDIT_PAGE,
  auditKindOf,
  type AuditKindName,
  type ListedAuditAction,
} from './audit-kinds.ts';

/** The most rows one page may ask for. */
export const AUDIT_PAGE_MAX = 100;

/** One kind of change (spec 0046, the kinds table). */
export const AuditKind = z.enum(AUDIT_KIND_NAMES);
/** One kind of change. */
export type AuditKind = z.infer<typeof AuditKind>;

/**
 * Where a page of the log starts: an opaque cursor from the previous page
 * (a position, never a key: one minted in another workspace still reads only
 * the caller's own rows). Milestone 1 takes no filters; the input is strict,
 * so adding them later can't be mistaken for an old caller's typo.
 */
export const AuditListInput = WorkspaceScoped.extend({
  cursor: z.string().min(1).max(200).optional(),
  limit: z.number().int().min(1).max(AUDIT_PAGE_MAX).default(AUDIT_PAGE),
}).strict();
/** Where a page of the log starts, and how many rows it holds. */
export type AuditListInput = z.input<typeof AuditListInput>;

/** When an entry happened: UTC, to the database's microsecond. */
const At = z.iso.datetime();

/**
 * A person as the log names them now (spec 0046, AC-4606): a member by the
 * name they have, with what happened to them (`former` once removed or gone,
 * `deleted` once their account was deleted, whose name is then only "Deleted
 * user"); someone asking to join, named from their request; the system; an API
 * key; or a member row that can't be read.
 */
export const AuditPerson = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('member'),
    memberId: Uuid,
    name: z.string(),
    state: z.enum(['active', 'former', 'deleted']),
  }),
  z.strictObject({ kind: z.literal('asker'), name: z.string() }),
  z.strictObject({ kind: z.literal('system') }),
  z.strictObject({ kind: z.literal('api_key') }),
  z.strictObject({ kind: z.literal('unknown') }),
]);
/** A person as the log names them now. */
export type AuditPerson = z.infer<typeof AuditPerson>;

/** A round robin, form, booking page or list, by its name now; `isGone` once deleted, and no name once purged. */
const NamedTarget = <T extends 'rotation' | 'form' | 'booking_page' | 'list'>(type: T) =>
  z.strictObject({ type: z.literal(type), id: Uuid, name: z.string().optional(), isGone: z.boolean() });

/**
 * What an entry was done to, named as it is now (AC-4607). A booking is its
 * page's title and its start; the record it may be linked to is never part of
 * it. An invitation is its address, or the invite link.
 */
export const AuditTarget = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('member'), person: AuditPerson }),
  z.strictObject({ type: z.literal('invitation'), id: Uuid, email: z.string().optional(), isLink: z.boolean() }),
  z.strictObject({ type: z.literal('join_request'), id: Uuid, name: z.string().optional() }),
  z.strictObject({ type: z.literal('workspace') }),
  NamedTarget('rotation'),
  NamedTarget('form'),
  NamedTarget('booking_page'),
  z.strictObject({
    type: z.literal('booking'),
    id: Uuid,
    pageTitle: z.string().optional(),
    startsAt: At.optional(),
    isGone: z.boolean(),
  }),
  NamedTarget('list'),
]);
/** What an entry was done to. */
export type AuditTarget = z.infer<typeof AuditTarget>;

/** One value in a change, typed so the screen formats it as the app does elsewhere. */
export const AuditValue = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('text'), text: z.string() }),
  z.strictObject({ kind: z.literal('role'), role: Role }),
  z.strictObject({ kind: z.literal('person'), person: AuditPerson }),
  z.strictObject({ kind: z.literal('rotation'), name: z.string().optional(), isGone: z.boolean() }),
  z.strictObject({ kind: z.literal('flag'), on: z.boolean() }),
  z.strictObject({ kind: z.literal('number'), value: z.number() }),
  z.strictObject({ kind: z.literal('time'), at: At }),
  z.strictObject({ kind: z.literal('zone'), zone: z.string() }),
  z.strictObject({ kind: z.literal('list'), items: z.array(z.string()) }),
]);
/** One value in a change. */
export type AuditValue = z.infer<typeof AuditValue>;

/** The fields a change can name; a stored key outside this list is dropped, never passed on. */
export const AUDIT_FIELDS = [
  'role',
  'actorRole',
  'name',
  'timeZone',
  'handle',
  'bio',
  'socials',
  'address',
  'domains',
  'expiresInDays',
  'maxUses',
  'requireTwoFactor',
  'sessionLengthDays',
  'purgeAfter',
  'units',
  'note',
  'seat',
  'reason',
  'rules',
  'leadsTo',
  'people',
] as const;
/** A field a change names. */
export const AuditField = z.enum(AUDIT_FIELDS);
/** A field a change names. */
export type AuditField = z.infer<typeof AuditField>;

/**
 * One changed field, before and after. A field set for the first time has no
 * `before`, a cleared one no `after`. A deleted account's own profile changes
 * keep their field names and lose their values (AC-4610).
 */
export const AuditChange = z.strictObject({
  field: AuditField,
  before: AuditValue.optional(),
  after: AuditValue.optional(),
});
/** One changed field, before and after. */
export type AuditChange = z.infer<typeof AuditChange>;

const NoParams = z.strictObject({});

/** What every entry carries beside its action, target and params. */
const entry = <const A extends readonly [string, ...string[]], T extends z.ZodType, P extends z.ZodType>(
  actions: A,
  target: T,
  params: P,
) =>
  z.strictObject({
    id: Uuid,
    at: At,
    action: z.literal(actions),
    actor: AuditPerson,
    target,
    params,
    changes: z.array(AuditChange),
  });

const member = AuditTarget.options[0];
const invitation = AuditTarget.options[1];
const joinRequest = AuditTarget.options[2];
const workspace = AuditTarget.options[3];
const rotation = AuditTarget.options[4];
const form = AuditTarget.options[5];
const bookingPage = AuditTarget.options[6];
const list = AuditTarget.options[8];
const booking = AuditTarget.options[7];

/**
 * One row of Workspace changes, a strict variant per action (actions whose
 * params match share one). `params` holds only what the action's sentence
 * names; `changes` the fields it changed, for the details (milestone 2).
 */
export const AuditEntryView = z.discriminatedUnion('action', [
  entry(['invitation.created'], invitation, z.strictObject({ role: Role.optional() })),
  /** `role` only when the resend changed it. */
  entry(['invitation.resent'], invitation, z.strictObject({ role: Role.optional() })),
  entry(['invitation.revoked', 'invitation.link_revoked'], invitation, NoParams),
  /**
   * Joined by an email invitation or the invite link (the actor joined, the target is their member row), or an
   * invitation used by someone already a member (the target is the invitation).
   */
  entry(
    ['invitation.accepted'],
    z.discriminatedUnion('type', [member, invitation]),
    z.strictObject({ via: z.enum(['email', 'link', 'already_member']), role: Role.optional() }),
  ),
  /** The link made, made again (the old one stopped working), or its settings changed. */
  entry(
    ['invitation.link_set'],
    invitation,
    z.strictObject({
      change: z.enum(['created', 'reset', 'changed']),
      role: Role.optional(),
      fields: z.array(z.enum(['role', 'expires', 'uses'])),
    }),
  ),
  entry(
    ['workspace.domains_set'],
    workspace,
    z.strictObject({ added: z.array(z.string()), removed: z.array(z.string()) }),
  ),
  /** The actor is the asker, named from their request. */
  entry(['join_request.created'], joinRequest, NoParams),
  entry(['join_request.approved'], member, z.strictObject({ alreadyMember: z.boolean() })),
  /** `account_deleted`: the system closed it when the asker deleted their account. */
  entry(['join_request.declined'], joinRequest, z.strictObject({ reason: z.literal('account_deleted').optional() })),
  entry(['member.role_changed'], member, z.strictObject({ from: Role.optional(), to: Role.optional() })),
  entry(['member.removed', 'member.left', 'workspace.ownership_transferred', 'account.deleted'], member, NoParams),
  /** `fields` holds only known fields; empty, the sentence says the profile changed. */
  entry(
    ['member.profile_updated'],
    member,
    z.strictObject({ isOwn: z.boolean(), fields: z.array(z.enum(['name', 'timeZone', 'handle', 'bio', 'socials'])) }),
  ),
  /** `from` and `to` only for a rename alone. */
  entry(
    ['workspace.updated'],
    workspace,
    z.strictObject({
      fields: z.array(z.enum(['name', 'timeZone', 'address'])),
      from: z.string().optional(),
      to: z.string().optional(),
    }),
  ),
  entry(['workspace.deleted'], workspace, z.strictObject({ purgeAfter: At.optional() })),
  entry(['workspace.restored', 'workspace_security.signed_out_everyone'], workspace, NoParams),
  /** Only the rules that changed are present; `sessionLengthDays: null` took the limit away. */
  entry(
    ['workspace_security.changed'],
    workspace,
    z.strictObject({
      requireTwoFactor: z.boolean().optional(),
      sessionLengthDays: z.number().int().nullable().optional(),
    }),
  ),
  entry(
    ['rotation.adjusted', 'rotation.adjustment_undone'],
    rotation,
    z.strictObject({ person: AuditPerson, units: z.number() }),
  ),
  /** `from` and `to` only when one seat moved. */
  entry(
    ['booking.reassigned'],
    booking,
    z.strictObject({ seats: z.number().int().min(0), from: AuditPerson.optional(), to: AuditPerson.optional() }),
  ),
  entry(['routing.changed'], z.discriminatedUnion('type', [form, bookingPage]), NoParams),
  entry(['form.owner_changed'], form, NoParams),
  /** How many people the form emailed before and after: who they are stays in the row. */
  entry(['form.notify_changed'], form, NoParams),
  /** A record link row names the booking only: the record is never named or sent. */
  entry(
    ['booking.no_show', 'booking.no_show_undone', 'booking.record_linked', 'booking.record_unlinked'],
    booking,
    NoParams,
  ),
  /**
   * Scheduling access (spec 0037, AC-1257): the target is the delegate; `over` the member whose scheduling it is,
   * absent for everyone's; `from` the level before a change.
   */
  entry(
    ['delegation.granted', 'delegation.changed', 'delegation.revoked'],
    member,
    z.strictObject({
      level: z.enum(['view', 'manage']),
      from: z.enum(['view', 'manage']).optional(),
      over: AuditPerson.optional(),
    }),
  ),
  /**
   * Someone's schedules changed (spec 0037, AC-1263): the target is the member whose they are; `kind` the write;
   * `schedule` the schedule's name when the write touched one (never its hours: the details hold no times yet).
   */
  entry(
    ['schedule.changed'],
    member,
    z.strictObject({
      kind: z.enum(['create', 'update', 'set_default', 'duplicate', 'delete', 'default_hours']),
      schedule: z.string().optional(),
    }),
  ),
  /** Time blocked or a block removed (spec 0037, AC-1263): the target is the member whose time it is. */
  entry(['block.created', 'block.removed'], member, NoParams),
  /** Time off added, changed or removed (spec 0037, AC-1282): the target is the member who is away. */
  entry(['time_off.created', 'time_off.changed', 'time_off.deleted'], member, NoParams),
  /** Someone's meeting limits set, changed or cleared (spec 0037, AC-1297): the target is the member whose they are. */
  entry(['limits.changed'], member, NoParams),
  /** Someone asked a member to reconnect their calendar (spec 0037, AC-1309): the target is that member. */
  entry(['calendar.reconnect_asked'], member, NoParams),
  /** A booking made, moved or cancelled by someone other than its host (spec 0037, AC-1263). */
  entry(
    ['booking.changed_for'],
    booking,
    z.strictObject({ host: AuditPerson, change: z.enum(['made', 'moved', 'cancelled']) }),
  ),
  /** A list made, changed, archived or restored (spec 0048); a rename shows as the name's change. */
  entry(['list.created', 'list.updated', 'list.archived', 'list.restored'], list, NoParams),
]);
/** One row of Workspace changes. */
export type AuditEntryView = z.infer<typeof AuditEntryView>;

/** A page of Workspace changes, newest first, and where the next one starts while there are more. */
export const AuditPage = z.strictObject({
  entries: z.array(AuditEntryView),
  nextCursor: z.string().optional(),
});
/** A page of Workspace changes. */
export type AuditPage = z.infer<typeof AuditPage>;

/**
 * The audit log (spec 0046). `list` needs `audit.read` (owners and admins);
 * anyone else gets 403 FORBIDDEN before any audit row is read. A cursor that
 * doesn't parse is 400 INPUT_INVALID. It writes nothing.
 */
export const auditContract = {
  list: oc.input(AuditListInput).output(AuditPage),
};
