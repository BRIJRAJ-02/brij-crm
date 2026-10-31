// Settings › History's words (spec 0046): the tabs, the table, every state, and
// one sentence per action Workspace changes lists (AC-4605). Imported only by
// History's screen modules, never by a route's loader, so the first load never
// carries them. A sentence names its actor first ("Ada changed Bea’s role from
// Member to Admin"); the Change column shows it from the word after the actor.
import type { AuditEntryView, AuditPerson, ListedAuditAction, Role } from '@crm/data';

/** One sentence: `actor` when it starts with the Who column's name, `none` when it starts elsewhere. */
export interface Sentence {
  readonly subject: 'actor' | 'none';
  /** The words after the actor's name, or the whole sentence when `subject` is `none`. */
  readonly text: string;
}

/** How a sentence names what it mentions, as History shows them now (AC-4606, AC-4607). */
export interface SentenceWords {
  /** A person by name: a member as named now, someone asking to join, "a deleted user", or "a former member" when unknown. */
  readonly person: (person: AuditPerson) => string;
  /** The same, possessive: "Bea’s". */
  readonly persons: (person: AuditPerson) => string;
  readonly role: (role: Role) => string;
  /** An invitation by its address, the invite link, or "someone" once its address is gone. */
  readonly invitation: (target: Extract<AuditEntryView['target'], { type: 'invitation' }>) => string;
  /** A booking as "Intro call on 24 Oct, 3:30 pm" in the reader's zone, or "a deleted booking". */
  readonly booking: (target: Extract<AuditEntryView['target'], { type: 'booking' }>) => string;
  /** A round robin, form, booking page or list by its name, or "a deleted round robin". */
  readonly thing: (target: {
    readonly type: 'rotation' | 'form' | 'booking_page' | 'list';
    readonly name?: string;
    readonly isGone: boolean;
  }) => string;
  /** A day in the reader's format. */
  readonly day: (at: string) => string;
  /** Words joined as a list: "name, time zone and bio". */
  readonly list: (words: readonly string[]) => string;
}

/** The entry variant an action reads as: actions that share params share a variant, so match by inclusion. */
type ByAction<E, A> = E extends { readonly action: infer X } ? (A extends X ? E : never) : never;
type EntryOf<A extends ListedAuditAction> = ByAction<AuditEntryView, A>;

/** One template per listed action: TypeScript refuses a missing one, and `history-lines.test.ts` walks them all. */
export type SentenceTemplates = {
  readonly [A in ListedAuditAction]: (entry: EntryOf<A>, w: SentenceWords) => Sentence;
};

const actor = (text: string): Sentence => ({ subject: 'actor', text });

/** A signed count of a round robin adjustment: "+2", "−1" (a minus sign, not a dash). */
const units = (value: number): string => (value > 0 ? `+${String(value)}` : `−${String(Math.abs(value))}`);

const PROFILE_FIELDS = {
  name: 'name',
  timeZone: 'time zone',
  jobTitle: 'job title',
  handle: 'public handle',
  bio: 'bio',
  socials: 'social links',
} as const;
const WORKSPACE_FIELDS = { name: 'name', timeZone: 'time zone', address: 'address' } as const;
const LINK_FIELDS = { role: 'role', expires: 'expiry', uses: 'number of uses' } as const;

const SENTENCES: SentenceTemplates = {
  'invitation.created': (entry, w) =>
    actor(
      entry.params.role === undefined
        ? `invited ${w.invitation(entry.target)}`
        : `invited ${w.invitation(entry.target)} as ${w.role(entry.params.role)}`,
    ),
  'invitation.resent': (entry, w) =>
    actor(
      entry.params.role === undefined
        ? `resent the invitation to ${w.invitation(entry.target)}`
        : `resent the invitation to ${w.invitation(entry.target)}, now as ${w.role(entry.params.role)}`,
    ),
  'invitation.revoked': (entry, w) => actor(`cancelled the invitation to ${w.invitation(entry.target)}`),
  'invitation.accepted': (entry, w) => {
    const as = entry.params.role === undefined ? '' : ` as ${w.role(entry.params.role)}`;
    if (entry.params.via === 'link') return actor(`joined through the invite link${as}`);
    if (entry.params.via === 'already_member' && entry.target.type === 'invitation') {
      return actor(`used the invitation to ${w.invitation(entry.target)} and was already a member`);
    }
    return actor(`accepted the invitation and joined${as}`);
  },
  'invitation.link_set': (entry, w) => {
    if (entry.params.change === 'created') {
      return actor(
        entry.params.role === undefined
          ? 'turned on the invite link'
          : `turned on the invite link, joining as ${w.role(entry.params.role)}`,
      );
    }
    if (entry.params.change === 'reset') return actor('made a new invite link, and the old one stopped working');
    const fields = entry.params.fields.map((field) => LINK_FIELDS[field]);
    return actor(fields.length === 0 ? 'changed the invite link' : `changed the invite link’s ${w.list(fields)}`);
  },
  'invitation.link_revoked': () => actor('turned off the invite link'),
  'workspace.domains_set': (entry, w) => {
    const parts = [
      ...(entry.params.added.length === 0 ? [] : [`added ${w.list(entry.params.added)}`]),
      ...(entry.params.removed.length === 0 ? [] : [`removed ${w.list(entry.params.removed)}`]),
    ];
    return actor(
      parts.length === 0
        ? 'changed the email domains that can ask to join'
        : `changed the email domains that can ask to join: ${parts.join(', ')}`,
    );
  },
  'join_request.created': () => actor('asked to join the workspace'),
  'join_request.approved': (entry, w) =>
    actor(
      entry.params.alreadyMember
        ? `approved ${w.persons(entry.target.person)} request, and they were already a member`
        : `let ${w.person(entry.target.person)} join as ${w.role('member')}`,
    ),
  'join_request.declined': (entry) => {
    const asker = entry.target.name ?? 'Someone';
    return entry.params.reason === 'account_deleted'
      ? { subject: 'none', text: `${asker}’s request to join closed when they deleted their account` }
      : actor(`declined ${entry.target.name ?? 'someone'}’s request to join`);
  },
  'member.role_changed': (entry, w) =>
    actor(
      entry.params.from === undefined || entry.params.to === undefined
        ? `changed ${w.persons(entry.target.person)} role`
        : `changed ${w.persons(entry.target.person)} role from ${w.role(entry.params.from)} to ${w.role(entry.params.to)}`,
    ),
  'member.removed': (entry, w) => actor(`removed ${w.person(entry.target.person)} from the workspace`),
  'member.left': () => actor('left the workspace'),
  'workspace.ownership_transferred': (entry, w) =>
    actor(`made ${w.person(entry.target.person)} an owner, and became an admin`),
  'account.deleted': () => actor('deleted their account and left the workspace'),
  'member.profile_updated': (entry, w) => {
    const whose = entry.params.isOwn ? 'their' : w.persons(entry.target.person);
    const fields = entry.params.fields.map((field) => PROFILE_FIELDS[field]);
    // No field this screen knows (one added since): the profile as a whole, never "changed their " and nothing.
    return actor(`changed ${whose} ${fields.length === 0 ? 'profile' : w.list(fields)}`);
  },
  'workspace.updated': (entry, w) => {
    if (entry.params.from !== undefined && entry.params.to !== undefined) {
      return actor(`renamed the workspace from ${entry.params.from} to ${entry.params.to}`);
    }
    const fields = entry.params.fields.map((field) => WORKSPACE_FIELDS[field]);
    return actor(fields.length === 0 ? 'changed the workspace' : `changed the workspace’s ${w.list(fields)}`);
  },
  'workspace.deleted': (entry, w) =>
    actor(
      entry.params.purgeAfter === undefined
        ? 'deleted the workspace'
        : `deleted the workspace, to be gone for good on ${w.day(entry.params.purgeAfter)}`,
    ),
  'workspace.restored': () => actor('restored the workspace'),
  'workspace_security.changed': (entry) => {
    const { requireTwoFactor, sessionLengthDays } = entry.params;
    if (requireTwoFactor !== undefined && sessionLengthDays !== undefined) return actor('changed the sign in rules');
    if (requireTwoFactor !== undefined) {
      return actor(`turned ${requireTwoFactor ? 'on' : 'off'} required two factor sign in`);
    }
    if (sessionLengthDays === null) return actor('removed the session limit');
    if (sessionLengthDays !== undefined) {
      return actor(
        `set sessions to end after ${String(sessionLengthDays)} ${sessionLengthDays === 1 ? 'day' : 'days'}`,
      );
    }
    return actor('changed the sign in rules');
  },
  'workspace_security.signed_out_everyone': () => actor('signed everyone out of the workspace'),
  'api_key.created': (entry) => actor(`made the API key ${entry.params.name}`),
  'api_key.revoked': (entry) => actor(`revoked the API key ${entry.params.name}`),
  'api_key.restored': (entry) => actor(`brought back the API key ${entry.params.name}`),
  'rotation.adjusted': (entry, w) =>
    actor(
      `adjusted ${w.persons(entry.params.person)} count in ${w.thing(entry.target)} by ${units(entry.params.units)}`,
    ),
  'rotation.adjustment_undone': (entry, w) =>
    actor(
      `undid a ${units(entry.params.units)} adjustment to ${w.persons(entry.params.person)} count in ${w.thing(entry.target)}`,
    ),
  'booking.reassigned': (entry, w) =>
    actor(
      entry.params.from !== undefined && entry.params.to !== undefined
        ? `reassigned ${w.booking(entry.target)} from ${w.person(entry.params.from)} to ${w.person(entry.params.to)}`
        : `reassigned ${String(entry.params.seats)} ${entry.params.seats === 1 ? 'seat' : 'seats'} of ${w.booking(entry.target)}`,
    ),
  'routing.changed': (entry, w) =>
    actor(
      entry.target.type === 'form'
        ? `published ${w.thing(entry.target)} with changed routing rules`
        : `changed the routing rules of ${w.thing(entry.target)}`,
    ),
  'form.owner_changed': (entry, w) => actor(`changed who gets ${w.thing(entry.target)}’s leads`),
  'form.notify_changed': (entry, w) => actor(`changed who is emailed ${w.thing(entry.target)}’s new submissions`),
  // Lists (spec 0048): "Ada made the list Sales pipeline".
  'list.created': (entry, w) => actor(`made the list ${w.thing(entry.target)}`),
  'list.updated': (entry, w) => actor(`changed the list ${w.thing(entry.target)}`),
  'list.archived': (entry, w) => actor(`archived the list ${w.thing(entry.target)}`),
  'list.restored': (entry, w) => actor(`restored the list ${w.thing(entry.target)}`),
  'booking.no_show': (entry, w) => actor(`marked ${w.booking(entry.target)} as a no show`),
  'booking.no_show_undone': (entry, w) => actor(`took back the no show on ${w.booking(entry.target)}`),
  'booking.record_linked': (entry, w) => actor(`linked ${w.booking(entry.target)} to a record`),
  'booking.record_unlinked': (entry, w) => actor(`unlinked a record from ${w.booking(entry.target)}`),
  // Scheduling access (spec 0037, AC-1257): "Ada let Priya manage Bea’s scheduling".
  'delegation.granted': (entry, w) =>
    actor(
      `let ${w.person(entry.target.person)} ${verbOf(entry.params.level)} ${whoseScheduling(entry.params.over, w)}`,
    ),
  'delegation.changed': (entry, w) =>
    actor(
      `now lets ${w.person(entry.target.person)} ${verbOf(entry.params.level)} ${whoseScheduling(entry.params.over, w)}`,
    ),
  'delegation.revoked': (entry, w) =>
    actor(
      `stopped ${w.person(entry.target.person)} being able to ${verbOf(entry.params.level)} ${whoseScheduling(entry.params.over, w)}`,
    ),
  // Someone's scheduling changed (spec 0037, AC-1263): "Priya changed Bea’s “Working hours” schedule".
  'schedule.changed': (entry, w) => {
    const whose = w.persons(entry.target.person);
    const named = entry.params.schedule === undefined ? undefined : `“${entry.params.schedule}”`;
    switch (entry.params.kind) {
      case 'create':
        return actor(`made ${whose} ${named ?? 'new'} schedule`);
      case 'duplicate':
        return actor(`copied one of ${whose} schedules${named === undefined ? '' : ` as ${named}`}`);
      case 'delete':
        return actor(`deleted ${whose} ${named === undefined ? 'schedule' : `${named} schedule`}`);
      case 'set_default':
        return actor(
          named === undefined ? `changed ${whose} default schedule` : `made ${named} ${whose} default schedule`,
        );
      case 'update':
      case 'default_hours':
        return actor(`changed ${whose} ${named === undefined ? 'hours' : `${named} schedule`}`);
    }
  },
  'block.created': (entry, w) => actor(`blocked time on ${w.persons(entry.target.person)} calendar`),
  'block.removed': (entry, w) => actor(`removed a block from ${w.persons(entry.target.person)} calendar`),
  'time_off.created': (entry, w) => actor(`added time off for ${w.person(entry.target.person)}`),
  'time_off.changed': (entry, w) => actor(`changed ${w.persons(entry.target.person)} time off`),
  'time_off.deleted': (entry, w) => actor(`removed ${w.persons(entry.target.person)} time off`),
  'limits.changed': (entry, w) => actor(`changed ${w.persons(entry.target.person)} meeting limits`),
  'calendar.reconnect_asked': (entry, w) => actor(`asked ${w.person(entry.target.person)} to reconnect their calendar`),
  'team.changed': (entry) => {
    const { team, joined, left } = entry.params;
    switch (entry.params.change) {
      case 'created':
        return actor(`made the ${team} team`);
      case 'renamed':
        return actor(
          `renamed the ${team} team to ${entry.changes[0]?.after?.kind === 'text' ? entry.changes[0].after.text : 'a new name'}`,
        );
      case 'deleted':
        return actor(`deleted the ${team} team`);
      case 'members': {
        if (joined > 0 && left > 0) return actor(`changed who is in the ${team} team`);
        if (left > 0) return actor(`took ${String(left)} ${left === 1 ? 'person' : 'people'} out of the ${team} team`);
        return actor(`added ${String(joined)} ${joined === 1 ? 'person' : 'people'} to the ${team} team`);
      }
    }
  },
  // Automations (parity #53): "Ada switched off an automation for Deals".
  'automation.changed': (entry) => {
    const { change, object } = entry.params;
    const verb = {
      created: 'made',
      updated: 'changed',
      enabled: 'switched on',
      disabled: 'switched off',
      deleted: 'deleted',
      restored: 'restored',
    }[change];
    return actor(`${verb} an automation for ${object}`);
  },
  'access.rule_set': (entry) => {
    const { object, who, level, records, fields, isDefault } = entry.params;
    if (isDefault) return actor(`set ${who} back to the default access to ${object}`);
    const what = { none: 'can’t see', read: 'can view', write: 'can edit' }[level];
    const which = records === 'all' ? '' : records === 'own' ? ', their own only' : ', their team’s only';
    const more = fields === 0 ? '' : `, ${String(fields)} ${fields === 1 ? 'field' : 'fields'} limited`;
    return actor(`changed access to ${object}: ${who} ${what}${level === 'none' ? '' : which}${more}`);
  },
  'booking.changed_for': (entry, w) => {
    const verb = { made: 'booked', moved: 'moved', cancelled: 'cancelled' }[entry.params.change];
    return actor(`${verb} ${w.booking(entry.target)} for ${w.person(entry.params.host)}`);
  },
  'booking_page.changed_for': (entry, w) =>
    actor(
      `${entry.params.deleted ? 'deleted' : 'changed'} ${w.persons(entry.target.person)} “${entry.params.page}” page`,
    ),
  'rotation.changed': (entry, w) => actor(`changed who is in ${w.thing(entry.target)}`),
};

/** A delegation's level as its verb: See or Manage. */
function verbOf(level: 'view' | 'manage'): string {
  return level === 'manage' ? 'manage' : 'see';
}

/** Whose scheduling a delegation is over: "Bea’s scheduling", or "everyone’s scheduling" with nobody named. */
function whoseScheduling(over: AuditPerson | undefined, w: SentenceWords): string {
  return over === undefined ? 'everyone’s scheduling' : `${w.persons(over)} scheduling`;
}

export const strings = {
  /** The page's tabs (owners and admins see both). */
  tabs: 'History',
  changesTab: 'Workspace changes',
  signInsTab: 'Your sign ins',
  /** Workspace changes' table. */
  table: 'Workspace changes',
  when: 'When',
  who: 'Who',
  change: 'Change',
  showMore: 'Show more',
  /** Show more, after the next page failed. */
  tryAgain: 'Try again',
  /** An action this page has no sentence for yet (a newer server), after the actor's name. */
  someChange: 'made a change',
  /** Who did it, beyond a member's name (AC-4606). */
  people: {
    former: 'Former member',
    deleted: 'Deleted user',
    system: 'System',
    apiKey: 'API key',
    /** An actor whose member row can't be read. */
    unknown: 'Unknown person',
    asker: 'Asked to join',
    /** A member the log can't name, inside a sentence. */
    unknownTarget: 'a former member',
    /** A deleted account, inside a sentence ("removed a deleted user from the workspace"). */
    deletedTarget: 'a deleted user',
  },
  /** A list the reader can't read (spec 0048): it is there, but never named. */
  someList: 'a list',
  /** What the log can't name any more (AC-4607). */
  gone: {
    /** An invitation whose address is gone: purged, or the member it made deleted their account. */
    invitation: 'someone',
    inviteLink: 'the invite link',
    booking: 'a deleted booking',
    rotation: 'a deleted round robin',
    form: 'a deleted form',
    list: 'a deleted list',
    booking_page: 'a deleted booking page',
  },
  /** "Intro call on 24 Oct, 3:30 pm". */
  bookingOn: (page: string, when: string) => `${page} on ${when}`,
  /** The states (AC-4615 to AC-4618). */
  emptyTitle: 'No changes yet',
  failedTitle: 'Couldn’t load workspace changes',
  failedMore: 'Couldn’t load more changes.',
  /** When the page itself failed and the data layer had no words for why. */
  failedText: 'Try again in a moment.',
  forbidden: 'Only workspace owners and admins can see workspace changes.',
  /** Your sign ins (AC-4619). */
  signInsTitle: 'Your sign ins',
  signInsText: 'Every workspace, last 90 days.',
  sentences: SENTENCES,
} as const;
