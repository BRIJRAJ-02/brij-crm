// One audit row as Workspace changes shows it (spec 0046): a pure mapping from
// the stored row and the names one statement resolved into a strict
// `AuditEntryView` variant. Only the keys each action is known to store are
// read; anything else in `before` or `after` is dropped, never passed on. A
// record a booking was linked to is never read here (the record may be hidden
// from the reader), and a deleted account's profile changes keep their field
// names and lose their values (AC-4610).
import {
  AUDIT_KINDS,
  type AuditChange,
  type AuditEntryView,
  type AuditPerson,
  type AuditValue,
  type ListedAuditAction,
} from '@crm/contracts';
import { ROLES, type RoleName } from '@crm/contracts/roles';
import { isUuid } from '../engine/ids.ts';

/** One audit row as the page statement reads it: never its IP or request id. */
export interface AuditRow {
  readonly id: string;
  /** UTC to the microsecond, as Postgres wrote it (`YYYY-MM-DDTHH:MM:SS.ffffffZ`). */
  readonly at: string;
  readonly actorType: string;
  readonly actorMemberId: string | null;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string | null;
  readonly before: unknown;
  readonly after: unknown;
}

/** A member as the log names them now. */
export interface AuditMemberName {
  readonly name: string;
  readonly state: 'active' | 'former' | 'deleted';
}

/** A round robin, form or booking page by its name now, and whether it was deleted. */
export interface AuditThingName {
  readonly name: string;
  readonly isGone: boolean;
  /** A list the reader can't read (spec 0048): named by no name, and its changes left out. */
  readonly isHidden?: boolean;
}

/** Every name a page mentions, by id, from the one names statement. A missing id was purged or never existed. */
export interface AuditNames {
  readonly members: ReadonlyMap<string, AuditMemberName>;
  readonly invitations: ReadonlyMap<string, { readonly email?: string; readonly isLink: boolean }>;
  readonly joinRequests: ReadonlyMap<string, string>;
  readonly rotations: ReadonlyMap<string, AuditThingName>;
  readonly forms: ReadonlyMap<string, AuditThingName>;
  readonly bookingPages: ReadonlyMap<string, AuditThingName>;
  readonly bookings: ReadonlyMap<string, { readonly pageTitle: string; readonly startsAt: string }>;
  readonly lists: ReadonlyMap<string, AuditThingName>;
}

/** The ids a page's names statement looks up, each list distinct and every id a uuid. */
export interface AuditNameIds {
  readonly members: readonly string[];
  readonly invitations: readonly string[];
  readonly joinRequests: readonly string[];
  readonly rotations: readonly string[];
  readonly forms: readonly string[];
  readonly bookingPages: readonly string[];
  readonly bookings: readonly string[];
  readonly lists: readonly string[];
}

type Bag = Readonly<Record<string, unknown>>;

const LISTED: ReadonlySet<string> = new Set(Object.values(AUDIT_KINDS).flat());

const bag = (value: unknown): Bag =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Bag) : {};
const text = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);
const numberOf = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const uuidOf = (value: unknown): string | undefined => (isUuid(value) ? value.toLowerCase() : undefined);
const roleOf = (value: unknown): RoleName | undefined =>
  typeof value === 'string' && (ROLES as readonly string[]).includes(value) ? (value as RoleName) : undefined;
const has = (record: Bag, key: string): boolean => Object.hasOwn(record, key);
const seatsOf = (value: unknown): readonly Bag[] => (Array.isArray(value) ? value.map(bag) : []);
const strings = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((each): each is string => typeof each === 'string') : [];

/** A stored time (an ISO string, from a JavaScript `Date`) as UTC ISO, or undefined when it isn't one. */
function timeOf(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? undefined : at.toISOString();
}

/** The ids every row of a page names: its actor, its target, and the people and round robins inside its changes. */
export function auditNameIds(rows: readonly AuditRow[]): AuditNameIds {
  const sets = {
    members: new Set<string>(),
    invitations: new Set<string>(),
    joinRequests: new Set<string>(),
    rotations: new Set<string>(),
    forms: new Set<string>(),
    bookingPages: new Set<string>(),
    bookings: new Set<string>(),
    lists: new Set<string>(),
  };
  const add = (set: Set<string>, value: unknown) => {
    const id = uuidOf(value);
    if (id !== undefined) set.add(id);
  };
  for (const row of rows) {
    if (row.actorType === 'member') add(sets.members, row.actorMemberId);
    const before = bag(row.before);
    const after = bag(row.after);
    switch (row.targetType) {
      case 'member':
        add(sets.members, row.targetId);
        break;
      case 'invitation':
        add(sets.invitations, row.targetId);
        break;
      case 'join_request':
        add(sets.joinRequests, row.targetId);
        break;
      case 'rotation':
        add(sets.rotations, row.targetId);
        break;
      case 'form':
        add(sets.forms, row.targetId);
        break;
      case 'booking_page':
        add(sets.bookingPages, row.targetId);
        break;
      case 'booking':
        add(sets.bookings, row.targetId);
        break;
      case 'list':
        add(sets.lists, row.targetId);
        break;
      default:
        break;
    }
    if (row.action === 'rotation.adjusted') add(sets.members, after.memberId);
    if (row.action === 'rotation.adjustment_undone') add(sets.members, before.memberId);
    if (row.action === 'booking.reassigned') {
      for (const seat of [...seatsOf(before.seats), ...seatsOf(after.seats)]) add(sets.members, seat.memberId);
    }
    if (row.action.startsWith('delegation.')) {
      for (const side of [before, after]) add(sets.members, side.targetMemberId);
    }
    if (row.action === 'booking.changed_for') add(sets.members, after.memberId);
    if (row.action === 'form.owner_changed') {
      for (const side of [before, after]) {
        add(sets.members, side.ownerMemberId);
        add(sets.rotations, side.ownerRotationId);
      }
    }
  }
  return {
    members: [...sets.members],
    invitations: [...sets.invitations],
    joinRequests: [...sets.joinRequests],
    rotations: [...sets.rotations],
    forms: [...sets.forms],
    bookingPages: [...sets.bookingPages],
    bookings: [...sets.bookings],
    lists: [...sets.lists],
  };
}

/** Builds one entry view from a stored row and the page's names. Undefined for an action Workspace changes doesn't list. */
export function toEntryView(row: AuditRow, names: AuditNames): AuditEntryView | undefined {
  if (!LISTED.has(row.action)) return undefined;
  const action = row.action as ListedAuditAction;
  const id = uuidOf(row.id);
  if (id === undefined) return undefined;
  const before = bag(row.before);
  const after = bag(row.after);
  const targetId = uuidOf(row.targetId);

  const person = (memberId: unknown): AuditPerson => {
    const found = uuidOf(memberId);
    const named = found === undefined ? undefined : names.members.get(found);
    return found === undefined || named === undefined
      ? { kind: 'unknown' }
      : { kind: 'member', memberId: found, name: named.name, state: named.state };
  };
  const actorOf = (): AuditPerson => {
    switch (row.actorType) {
      case 'member':
        return person(row.actorMemberId);
      case 'api_key':
        return { kind: 'api_key' };
      default:
        // The system, and the system's own kinds of actor (an automation, a form, a booking page).
        return { kind: 'system' };
    }
  };
  const base = { id, at: row.at, actor: actorOf() };

  const memberTarget = () => ({ type: 'member' as const, person: person(row.targetId) });
  const invitationTarget = () => {
    const found = targetId === undefined ? undefined : names.invitations.get(targetId);
    return {
      type: 'invitation' as const,
      id: targetId ?? row.id,
      ...(found?.email === undefined ? {} : { email: found.email }),
      isLink: found?.isLink ?? false,
    };
  };
  const joinRequestTarget = () => {
    const name = targetId === undefined ? undefined : names.joinRequests.get(targetId);
    return { type: 'join_request' as const, id: targetId ?? row.id, ...(name === undefined ? {} : { name }) };
  };
  const thing = <T extends 'rotation' | 'form' | 'booking_page' | 'list'>(
    type: T,
    map: ReadonlyMap<string, AuditThingName>,
  ) => {
    const found = targetId === undefined ? undefined : map.get(targetId);
    return {
      type,
      id: targetId ?? row.id,
      ...(found === undefined ? {} : { name: found.name }),
      isGone: found?.isGone ?? true,
    };
  };
  const bookingTarget = () => {
    const found = targetId === undefined ? undefined : names.bookings.get(targetId);
    return {
      type: 'booking' as const,
      id: targetId ?? row.id,
      ...(found === undefined ? {} : { pageTitle: found.pageTitle, startsAt: found.startsAt }),
      isGone: found === undefined,
    };
  };
  const workspace = { type: 'workspace' as const };

  const role = (value: unknown): AuditValue | undefined => {
    const found = roleOf(value);
    return found === undefined ? undefined : { kind: 'role', role: found };
  };
  const plain = (value: unknown): AuditValue | undefined => {
    const found = text(value);
    return found === undefined ? undefined : { kind: 'text', text: found };
  };
  const zone = (value: unknown): AuditValue | undefined => {
    const found = text(value);
    return found === undefined ? undefined : { kind: 'zone', zone: found };
  };
  const count = (value: unknown): AuditValue | undefined => {
    const found = numberOf(value);
    return found === undefined ? undefined : { kind: 'number', value: found };
  };
  const flag = (value: unknown): AuditValue | undefined =>
    typeof value === 'boolean' ? { kind: 'flag', on: value } : undefined;
  const change = (
    field: AuditChange['field'],
    was: AuditValue | undefined,
    now: AuditValue | undefined,
  ): AuditChange[] =>
    was === undefined && now === undefined
      ? []
      : [{ field, ...(was === undefined ? {} : { before: was }), ...(now === undefined ? {} : { after: now }) }];

  switch (action) {
    case 'invitation.created': {
      const made = roleOf(after.role);
      return {
        ...base,
        action,
        target: invitationTarget(),
        params: made === undefined ? {} : { role: made },
        changes: change('role', undefined, role(after.role)),
      };
    }
    case 'invitation.resent': {
      const now = roleOf(after.role);
      const changed = now !== undefined && roleOf(before.role) !== undefined && roleOf(before.role) !== now;
      return {
        ...base,
        action,
        target: invitationTarget(),
        params: changed ? { role: now } : {},
        changes: changed ? change('role', role(before.role), role(after.role)) : [],
      };
    }
    case 'invitation.revoked':
    case 'invitation.link_revoked':
      return { ...base, action, target: invitationTarget(), params: {}, changes: [] };
    case 'invitation.accepted': {
      const joined = roleOf(after.role);
      if (row.targetType === 'invitation') {
        return {
          ...base,
          action,
          target: invitationTarget(),
          params: { via: 'already_member' },
          changes: [],
        };
      }
      return {
        ...base,
        action,
        target: memberTarget(),
        params: { via: after.via === 'link' ? 'link' : 'email', ...(joined === undefined ? {} : { role: joined }) },
        changes: change('role', undefined, role(after.role)),
      };
    }
    case 'invitation.link_set': {
      const made = after.created === true ? 'created' : after.reset === true ? 'reset' : 'changed';
      const joins = roleOf(after.role);
      const fields = [
        ...(made === 'changed' && has(after, 'role') ? (['role'] as const) : []),
        ...(has(after, 'expiresInDays') ? (['expires'] as const) : []),
        ...(has(after, 'maxUses') ? (['uses'] as const) : []),
      ];
      return {
        ...base,
        action,
        target: invitationTarget(),
        params: { change: made, ...(joins === undefined ? {} : { role: joins }), fields },
        changes: [
          ...change('role', undefined, role(after.role)),
          ...change('expiresInDays', undefined, count(after.expiresInDays)),
          ...change('maxUses', undefined, count(after.maxUses)),
        ],
      };
    }
    case 'workspace.domains_set': {
      const was = strings(before.domains);
      const now = strings(after.domains);
      return {
        ...base,
        action,
        target: workspace,
        params: {
          added: now.filter((domain) => !was.includes(domain)),
          removed: was.filter((domain) => !now.includes(domain)),
        },
        changes: [
          { field: 'domains', before: { kind: 'list', items: [...was] }, after: { kind: 'list', items: [...now] } },
        ],
      };
    }
    case 'join_request.created': {
      const target = joinRequestTarget();
      return {
        ...base,
        // The asker isn't a member: the log names them from their request.
        actor: target.name === undefined ? { kind: 'unknown' } : { kind: 'asker', name: target.name },
        action,
        target,
        params: {},
        changes: [],
      };
    }
    case 'join_request.approved':
      return {
        ...base,
        action,
        target: memberTarget(),
        params: { alreadyMember: after.alreadyMember === true },
        changes: change('role', undefined, role(after.role)),
      };
    case 'join_request.declined':
      return {
        ...base,
        action,
        target: joinRequestTarget(),
        params: after.reason === 'account_deleted' ? { reason: 'account_deleted' } : {},
        changes: [],
      };
    case 'member.role_changed': {
      const from = roleOf(before.role);
      const to = roleOf(after.role);
      // A custom role (spec 0037) by the name it had then.
      const fromName = text(before.customRoleName);
      const toName = text(after.customRoleName);
      return {
        ...base,
        action,
        target: memberTarget(),
        params: {
          ...(from === undefined ? {} : { from }),
          ...(to === undefined ? {} : { to }),
          ...(fromName === undefined ? {} : { fromName }),
          ...(toName === undefined ? {} : { toName }),
        },
        changes: change('role', role(before.role), role(after.role)),
      };
    }
    case 'workspace.ownership_transferred':
      return {
        ...base,
        action,
        target: memberTarget(),
        params: {},
        changes: [
          ...change('role', role(before.toRole), role(after.toRole)),
          ...change('actorRole', role(before.fromRole), role(after.fromRole)),
        ],
      };
    case 'member.removed':
    case 'member.left':
    case 'account.deleted':
      return { ...base, action, target: memberTarget(), params: {}, changes: [] };
    case 'member.profile_updated': {
      const target = memberTarget();
      const known = (['name', 'timeZone', 'handle', 'bio', 'socials'] as const).filter(
        (field) => has(after, field) || has(before, field),
      );
      // A deleted account's own values went with it (AC-4610): the fields stay named, their values don't.
      const forgotten = target.person.kind === 'member' && target.person.state === 'deleted';
      // Social links (booking socials, 25 Oct 2026) are stored as their list of links.
      const valueOf = (field: (typeof known)[number], value: unknown): AuditValue | undefined =>
        forgotten
          ? undefined
          : field === 'timeZone'
            ? zone(value)
            : field === 'socials'
              ? Array.isArray(value)
                ? { kind: 'list', items: [...strings(value)] }
                : undefined
              : plain(value);
      return {
        ...base,
        action,
        target,
        params: {
          isOwn: row.actorType === 'member' && uuidOf(row.actorMemberId) === targetId,
          fields: known,
        },
        changes: known.map((field) => {
          const was = valueOf(field, before[field]);
          const now = valueOf(field, after[field]);
          return { field, ...(was === undefined ? {} : { before: was }), ...(now === undefined ? {} : { after: now }) };
        }),
      };
    }
    case 'workspace.updated': {
      const fields = [
        ...(has(after, 'name') ? (['name'] as const) : []),
        ...(has(after, 'timeZone') ? (['timeZone'] as const) : []),
        ...(has(after, 'slug') ? (['address'] as const) : []),
      ];
      const from = text(before.name);
      const to = text(after.name);
      const renamedOnly = fields.length === 1 && fields[0] === 'name' && from !== undefined && to !== undefined;
      return {
        ...base,
        action,
        target: workspace,
        params: { fields, ...(renamedOnly ? { from, to } : {}) },
        changes: [
          ...change('name', plain(before.name), plain(after.name)),
          ...change('timeZone', zone(before.timeZone), zone(after.timeZone)),
          ...change('address', plain(before.slug), plain(after.slug)),
        ],
      };
    }
    case 'workspace.deleted': {
      const purgeAfter = timeOf(after.purgeAfter);
      return {
        ...base,
        action,
        target: workspace,
        params: purgeAfter === undefined ? {} : { purgeAfter },
        changes: change(
          'purgeAfter',
          undefined,
          purgeAfter === undefined ? undefined : { kind: 'time', at: purgeAfter },
        ),
      };
    }
    case 'workspace.restored':
    case 'workspace_security.signed_out_everyone':
      return { ...base, action, target: workspace, params: {}, changes: [] };
    case 'workspace_security.changed': {
      const twoFactor = typeof after.requireTwoFactor === 'boolean' ? after.requireTwoFactor : undefined;
      const days = has(after, 'sessionLengthDays')
        ? after.sessionLengthDays === null
          ? null
          : numberOf(after.sessionLengthDays)
        : undefined;
      return {
        ...base,
        action,
        target: workspace,
        params: {
          ...(twoFactor === undefined ? {} : { requireTwoFactor: twoFactor }),
          ...(days === undefined ? {} : { sessionLengthDays: days === null ? null : Math.trunc(days) }),
        },
        changes: [
          ...change('requireTwoFactor', flag(before.requireTwoFactor), flag(after.requireTwoFactor)),
          ...change('sessionLengthDays', count(before.sessionLengthDays), count(after.sessionLengthDays)),
        ],
      };
    }
    case 'rotation.adjusted':
    case 'rotation.adjustment_undone': {
      const stored = action === 'rotation.adjusted' ? after : before;
      return {
        ...base,
        action,
        target: thing('rotation', names.rotations),
        params: { person: person(stored.memberId), units: numberOf(stored.units) ?? 0 },
        changes: [...change('units', undefined, count(stored.units)), ...change('note', undefined, plain(stored.note))],
      };
    }
    case 'booking.reassigned': {
      const was = seatsOf(before.seats);
      const now = seatsOf(after.seats);
      const one = now.length === 1 ? now[0] : undefined;
      const wasOne = one === undefined ? undefined : was.find((seat) => seat.rotationId === one.rotationId);
      return {
        ...base,
        action,
        target: bookingTarget(),
        params: {
          seats: now.length,
          ...(one === undefined ? {} : { from: person(wasOne?.memberId), to: person(one.memberId) }),
        },
        changes: [
          ...now.flatMap((seat) => {
            const old = was.find((each) => each.rotationId === seat.rotationId);
            return change('seat', old === undefined ? undefined : { kind: 'person', person: person(old.memberId) }, {
              kind: 'person',
              person: person(seat.memberId),
            });
          }),
          ...change('reason', undefined, plain(after.reason)),
        ],
      };
    }
    case 'routing.changed':
      return {
        ...base,
        action,
        target: row.targetType === 'form' ? thing('form', names.forms) : thing('booking_page', names.bookingPages),
        params: {},
        changes: change('rules', count(before.rules), count(after.rules)),
      };
    case 'form.owner_changed': {
      const leadsTo = (side: Bag): AuditValue | undefined => {
        const rotationId = uuidOf(side.ownerRotationId);
        if (rotationId !== undefined) {
          const found = names.rotations.get(rotationId);
          return {
            kind: 'rotation',
            ...(found === undefined ? {} : { name: found.name }),
            isGone: found?.isGone ?? true,
          };
        }
        return uuidOf(side.ownerMemberId) === undefined
          ? undefined
          : { kind: 'person', person: person(side.ownerMemberId) };
      };
      return {
        ...base,
        action,
        target: thing('form', names.forms),
        params: {},
        changes: change('leadsTo', leadsTo(before), leadsTo(after)),
      };
    }
    case 'form.notify_changed': {
      const people = (side: Bag) =>
        Array.isArray(side.notifyMemberIds) ? count(side.notifyMemberIds.length) : undefined;
      return {
        ...base,
        action,
        target: thing('form', names.forms),
        params: {},
        changes: change('people', people(before), people(after)),
      };
    }
    case 'booking.no_show':
    case 'booking.no_show_undone':
    case 'booking.record_linked':
    case 'booking.record_unlinked':
      // A record link names the booking only: the record's id stays in the row, unread (it may be hidden).
      return { ...base, action, target: bookingTarget(), params: {}, changes: [] };
    case 'delegation.granted':
    case 'delegation.changed':
    case 'delegation.revoked': {
      // Scheduling access (spec 0037, AC-1257): the delegate is the target; a level the code doesn't know is no row.
      const levelOf = (value: unknown) => (value === 'view' || value === 'manage' ? value : undefined);
      const stored = action === 'delegation.revoked' ? before : after;
      const level = levelOf(stored.level);
      if (level === undefined || (stored.targetType !== 'member' && stored.targetType !== 'everyone')) return undefined;
      const from = action === 'delegation.changed' ? levelOf(before.level) : undefined;
      const over = stored.targetType === 'member' ? person(stored.targetMemberId) : undefined;
      return {
        ...base,
        action,
        target: memberTarget(),
        params: { level, ...(from === undefined ? {} : { from }), ...(over === undefined ? {} : { over }) },
        changes: [],
      };
    }
    case 'schedule.changed': {
      // A write the code doesn't know is no row (AC-1223); the schedule's name only when it touched one.
      const kind = after.kind ?? before.kind;
      if (
        kind !== 'create' &&
        kind !== 'update' &&
        kind !== 'set_default' &&
        kind !== 'duplicate' &&
        kind !== 'delete' &&
        kind !== 'default_hours'
      ) {
        return undefined;
      }
      const touched = [...seatsOf(after.schedules), ...seatsOf(before.schedules)];
      const name = text(touched[0]?.name);
      return {
        ...base,
        action,
        target: memberTarget(),
        params: { kind, ...(name === undefined ? {} : { schedule: name }) },
        changes: [],
      };
    }
    case 'block.created':
    case 'block.removed':
    case 'time_off.created':
    case 'time_off.changed':
    case 'time_off.deleted':
    case 'limits.changed':
    case 'calendar.reconnect_asked':
      // Whose time and when stay in the row; the sentence names whose (a block's label is never stored).
      return { ...base, action, target: memberTarget(), params: {}, changes: [] };
    case 'booking.changed_for': {
      const made = after.change;
      if (made !== 'made' && made !== 'moved' && made !== 'cancelled') return undefined;
      return {
        ...base,
        action,
        target: bookingTarget(),
        params: { host: person(after.memberId), change: made },
        changes: [],
      };
    }
    case 'role.created':
    case 'role.updated':
    case 'role.deleted':
    case 'role.default_changed': {
      // The role by the name it had then (spec 0037); a change counts the permissions it added and took away.
      const counted = (value: unknown) => (Array.isArray(value) ? value.length : undefined);
      const added = counted(after.added);
      const removed = counted(after.removed);
      const moved =
        typeof after.moved === 'number' && Number.isInteger(after.moved) && after.moved >= 0 ? after.moved : undefined;
      return {
        ...base,
        action,
        target: workspace,
        params: {
          role: text(after.name) ?? text(before.name) ?? 'a role',
          ...(added === undefined ? {} : { added }),
          ...(removed === undefined ? {} : { removed }),
          ...(moved === undefined ? {} : { moved }),
        },
        changes: action === 'role.updated' ? change('name', plain(before.name), plain(after.name)) : [],
      };
    }
    case 'team.changed': {
      const kind = after.change;
      if (kind !== 'created' && kind !== 'renamed' && kind !== 'deleted' && kind !== 'members') {
        return undefined;
      }
      // A rename names the team as it was called then; the others carry the name they had (a delete, only in `before`).
      const team = text(after.name) ?? text(before.name) ?? '';
      return {
        ...base,
        action,
        target: workspace,
        params: {
          change: kind,
          team: kind === 'renamed' ? (text(before.name) ?? team) : team,
          joined: Array.isArray(after.joined) ? after.joined.length : 0,
          left: Array.isArray(after.left) ? after.left.length : 0,
        },
        changes: kind === 'renamed' ? change('name', plain(before.name), plain(after.name)) : [],
      };
    }
    case 'access.rule_set': {
      const level = after.level;
      const records = after.records;
      if (level !== 'none' && level !== 'read' && level !== 'write') return undefined;
      if (records !== 'all' && records !== 'own' && records !== 'team') return undefined;
      const subject = text(after.subject);
      const who = subject === 'team' ? (text(after.team) ?? 'a team') : subject === 'guest' ? 'Guests' : 'Members';
      return {
        ...base,
        action,
        target: workspace,
        params: {
          object: text(after.object) ?? 'an object',
          who,
          level,
          records,
          fields: Object.keys(bag(after.fields)).length,
          isDefault: after.isDefault === true,
        },
        changes: [],
      };
    }
    case 'list.created':
    case 'list.archived':
    case 'list.restored':
    case 'list.updated': {
      const found = targetId === undefined ? undefined : names.lists.get(targetId);
      // A list the reader can't read is "a list": no name, and no names in its changes.
      if (found?.isHidden === true) {
        return {
          ...base,
          action,
          target: { type: 'list', id: targetId ?? row.id, isGone: false },
          params: {},
          changes: [],
        };
      }
      return {
        ...base,
        action,
        target: thing('list', names.lists),
        params: {},
        changes: action === 'list.updated' ? change('name', plain(before.name), plain(after.name)) : [],
      };
    }
    default:
      return undefined;
  }
}
