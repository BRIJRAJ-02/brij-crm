// Meeting attendees who aren't in the CRM yet (spec 0024, AC-609, milestone
// 2). A member adds one from a meeting on a timeline ("Add as person"): the
// person is made through the access door as that member, with their email,
// the name the calendar gives (else the address before the `@`), and their
// company when exactly one company holds the email's domain; every meeting
// that listed the address as unknown then links them. With the workspace
// setting on (admins, off by default), the sync makes them itself, as the
// system, for every unknown external attendee of the meetings it writes.
import { sql } from 'drizzle-orm';
import type { AddedMeetingAttendee, CalendarSettingsView } from '@crm/contracts';
import type { WorkspaceTx } from '@crm/db';
import { requirePermission } from '../access/check.ts';
import { checkScope, type EngineScope } from '../access/mint.ts';
import { can, isOpen } from '../access/policy.ts';
import { inWorkspace } from '../access/run.ts';
import { visibleRecords } from '../access/visibility.ts';
import { splitName } from '../booking/visitor.ts';
import { checkId, uuidList } from '../engine/ids.ts';
import { insertRecord } from '../engine/records.ts';
import { refuse } from '../engine/refusals.ts';
import { loadAttributes, type AttributeDef } from '../engine/values.ts';
import { runWrite, type AfterWrite, type MeetingChange, type WriteContext } from '../engine/write.ts';
import { checkMeetingRecord } from './meetings.ts';
import { domainOf, holders, matchEvent, recordsOf, shouldSync, type Lookups } from './match.ts';
import { isGoogleCalendarId, normaliseEmail, type ProviderEvent } from './provider.ts';

/** What an attendee that can't be added answers: the same whether they are a member, matched, or hidden. */
export const ATTENDEE_NOT_ADDABLE = 'That attendee can’t be added as a person.';

/** What an attendee on no meeting the reader may see answers. */
export const UNKNOWN_ATTENDEE = 'That attendee is not on this meeting.';

/** The most people one sync batch makes (a batch is at most 200 events). */
export const MAX_PEOPLE_PER_BATCH = 200;

/** The People and Companies objects, and the attributes filing a person writes. */
interface PersonSetup {
  readonly people: string;
  readonly email: AttributeDef;
  readonly name?: AttributeDef;
  readonly company?: AttributeDef;
  readonly companies?: string;
  readonly domains?: AttributeDef;
}

/** The live attribute of an object with this api slug. */
function bySlug(attributes: ReadonlyMap<string, AttributeDef>, apiSlug: string): AttributeDef | undefined {
  return [...attributes.values()].find((attribute) => attribute.apiSlug === apiSlug && attribute.archivedAt === null);
}

/** The standard People and Companies, as filing a person needs them; undefined when People has no email attribute. */
async function personSetup(tx: WorkspaceTx): Promise<PersonSetup | undefined> {
  const rows = await tx.execute<{ id: string; standard_key: string }>(sql`
    select id::text as id, standard_key from objects
    where standard_key in ('people', 'companies') and archived_at is null
  `);
  const people = rows.rows.find((row) => row.standard_key === 'people')?.id;
  const companies = rows.rows.find((row) => row.standard_key === 'companies')?.id;
  if (people === undefined) return undefined;
  const attributes = await loadAttributes(tx, people);
  const email = bySlug(attributes, 'email_addresses');
  if (email?.type !== 'email') return undefined;
  const name = bySlug(attributes, 'name');
  const company = bySlug(attributes, 'company');
  const domains = companies === undefined ? undefined : bySlug(await loadAttributes(tx, companies), 'domains');
  return {
    people,
    email,
    ...(name === undefined ? {} : { name }),
    ...(company?.type === 'record_reference' && companies !== undefined ? { company, companies } : {}),
    ...(domains?.type === 'domain' ? { domains } : {}),
  };
}

/** The one company holding the email's domain (never a free email domain), if exactly one does. */
async function companyFor(
  tx: WorkspaceTx,
  setup: PersonSetup,
  email: string,
  isFreeDomain: (domain: string) => boolean,
): Promise<string | undefined> {
  const domain = domainOf(email);
  if (domain === undefined || isFreeDomain(domain) || setup.domains === undefined) return undefined;
  const found = (await holders(tx, [setup.domains.id], [domain])).get(domain) ?? [];
  const [only] = found;
  return found.length === 1 ? only : undefined;
}

/** Makes one person in the write: their email, a name, and their company. */
async function makePerson(
  context: WriteContext,
  setup: PersonSetup,
  attendee: { readonly email: string; readonly name?: string },
  companyId: string | undefined,
): Promise<string> {
  // The calendar's name, else the address before the `@`: People's name is required.
  const given = attendee.name?.trim();
  const name = given === undefined || given === '' ? attendee.email.slice(0, attendee.email.lastIndexOf('@')) : given;
  const named =
    name === '' || setup.name === undefined
      ? {}
      : setup.name.type === 'personal_name'
        ? { [setup.name.id]: splitName(name) }
        : setup.name.type === 'text'
          ? { [setup.name.id]: name }
          : {};
  const made = await insertRecord(context, {
    objectId: setup.people,
    values: {
      [setup.email.id]: setup.email.isMulti ? [attendee.email] : attendee.email,
      ...named,
      ...(companyId === undefined || setup.company === undefined || setup.companies === undefined
        ? {}
        : { [setup.company.id]: { objectId: setup.companies, recordId: companyId } }),
    },
  });
  return made.recordId;
}

/**
 * Links every meeting that lists `email` as unknown to `personId` (AC-606):
 * the attendee becomes `linked`, and each meeting that isn't internal shows
 * on the person's timeline. Answers each meeting touched with every record it
 * shows on now.
 */
async function linkEmail(tx: WorkspaceTx, email: string, personId: string): Promise<readonly MeetingChange[]> {
  const changed = await tx.execute<{ meeting_id: string }>(sql`
    update meeting_attendees set match = 'linked', person_record_id = ${personId}::uuid
    where email = ${email} and match = 'unknown'
    returning meeting_id::text as meeting_id
  `);
  const meetingIds = [...new Set(changed.rows.map((row) => row.meeting_id))];
  if (meetingIds.length === 0) return [];
  // Only meetings a syncing calendar holds go on records (AC-1002): one a calendar only shows on its member's week
  // keeps its attendee matched, and stays off every timeline.
  // The same rule as apply.ts's `linkedMeetings` (which imports this file, so it is written out here).
  const linked = await tx.execute<{ id: string }>(sql`
    select m.id::text as id from meetings m
    where m.id = any(${uuidList(meetingIds)}) and (
      m.created_by_crm or exists (
        select 1 from meeting_sources s
        join calendar_calendars k on k.workspace_id = s.workspace_id and k.connection_id = s.connection_id
          and k.provider_calendar_id = s.calendar_id
        where s.workspace_id = m.workspace_id and s.meeting_id = m.id and (k.sync or s.created_by_crm)
      )
    )
  `);
  const linkable = linked.rows.map((row) => row.id);
  if (linkable.length === 0) return [];
  await tx.execute(sql`
    insert into meeting_records (workspace_id, meeting_id, record_id, via, starts_at)
    select m.workspace_id, m.id, ${personId}::uuid, 'attendee', m.starts_at
    from meetings m where m.id = any(${uuidList(linkable)}) and not m.is_internal
    on conflict (workspace_id, meeting_id, record_id) do update set via = 'attendee'
  `);
  const after = await recordsOf(tx, linkable);
  return linkable.map((meetingId) => ({ meetingId, recordIds: after.get(meetingId) ?? [] }));
}

/**
 * Whether the sync may file an event's unknown attendees as people (AC-609): not from an invite the account hasn't
 * answered whose only other party is its organiser. Anyone can send such an invite (a stranger's booking, spam), so
 * it makes nobody until the member accepts; the meeting itself still shows. An invite listing other guests, or one
 * the member answered, files as before.
 */
export function filesPeople(event: ProviderEvent): boolean {
  const self = event.attendees.find((attendee) => attendee.isSelf);
  if (self?.response !== 'needs_action') return true;
  const others = event.attendees.filter((attendee) => !attendee.isSelf);
  return !others.every((attendee) => attendee.isOrganizer);
}

/** Whether the workspace makes people for unknown attendees (AC-609): off until an admin turns it on. */
export async function createsUnknownPeople(tx: WorkspaceTx): Promise<boolean> {
  const rows = await tx.execute<{ on: boolean }>(sql`select create_unknown_people as on from calendar_settings`);
  return rows.rows[0]?.on === true;
}

/**
 * Makes a person, as the write's actor, for each unknown external attendee of
 * the batch's meetings (AC-609, the workspace setting on), never a Google
 * calendar's own id nor from an unanswered invite by its organiser alone
 * (`filesPeople`), each under its own
 * savepoint so one refused (a full workspace, a rule) makes the rest still.
 * Answers how many it made; the caller reads the lookups again when any.
 */
export async function fileUnknownAttendees(
  context: WriteContext,
  events: readonly ProviderEvent[],
  connectionMemberId: string,
  lookups: Lookups,
): Promise<number> {
  const unknown = new Map<string, string | undefined>();
  for (const event of events) {
    if (!shouldSync(event) || !filesPeople(event)) continue;
    const { attendees, isInternal } = matchEvent(event, connectionMemberId, lookups);
    if (isInternal) continue;
    for (const attendee of attendees) {
      if (attendee.match !== 'unknown' || unknown.has(attendee.email) || isGoogleCalendarId(attendee.email)) continue;
      unknown.set(attendee.email, attendee.name ?? undefined);
    }
  }
  if (unknown.size === 0) return 0;
  const setup = await personSetup(context.tx);
  if (setup === undefined) return 0;
  let made = 0;
  for (const [email, name] of [...unknown].slice(0, MAX_PEOPLE_PER_BATCH)) {
    const domain = domainOf(email);
    const companies = domain === undefined ? [] : (lookups.companies.get(domain) ?? []);
    const [company] = companies;
    const companyId =
      domain !== undefined && !lookups.isFreeDomain(domain) && companies.length === 1 ? company : undefined;
    const done = await context.perRecord((inner) =>
      makePerson(inner, setup, { email, ...(name === undefined ? {} : { name }) }, companyId),
    );
    if (done.ok) made += 1;
  }
  return made;
}

/** Adding one attendee of a meeting on a record the reader sees (`calendar.meetings.addAttendee`). */
export interface AddMeetingAttendeeInput {
  readonly recordId: string;
  readonly meetingId: string;
  readonly email: string;
}

/**
 * Adds an attendee the CRM doesn't know as a person (AC-609), as the reader,
 * through the access door: the record must be visible to them, the meeting on
 * it and not private to someone else, and the attendee unknown. The person
 * gets their email, the calendar's name and the company holding their
 * domain (when exactly one does and the reader can see it), and every
 * meeting listing the address links them. Anything else that isn't
 * addable answers one sentence, so a hidden person is never revealed.
 */
export async function addMeetingAttendee(
  scope: EngineScope,
  input: AddMeetingAttendeeInput,
  options: { readonly isFreeDomain: (domain: string) => boolean },
  hooks: readonly AfterWrite[] = [],
): Promise<AddedMeetingAttendee> {
  checkScope(scope);
  const recordId = checkId(input.recordId, UNKNOWN_ATTENDEE);
  const meetingId = checkId(input.meetingId, UNKNOWN_ATTENDEE);
  const email = normaliseEmail(input.email);
  const me = scope.access.principal.kind === 'member' ? scope.access.principal.memberId : null;
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      await checkMeetingRecord(tx, scope.access, recordId);
      const found = await tx.execute<{ match: string; name: string | null; hidden: boolean }>(sql`
        select a.match, a.name, (m.is_private and not exists (
          select 1 from meeting_sources s
          join calendar_connections c on c.workspace_id = s.workspace_id and c.id = s.connection_id
          where s.workspace_id = m.workspace_id and s.meeting_id = m.id and c.member_id = ${me}::uuid
        )) as hidden
        from meeting_records l
        join meetings m on m.workspace_id = l.workspace_id and m.id = l.meeting_id
        join meeting_attendees a on a.workspace_id = m.workspace_id and a.meeting_id = m.id
        where l.record_id = ${recordId}::uuid and l.meeting_id = ${meetingId}::uuid and a.email = ${email}
        for update of a
      `);
      const [row] = found.rows;
      if (row === undefined || row.hidden) throw refuse('NOT_FOUND', UNKNOWN_ATTENDEE);
      if (row.match !== 'unknown') throw refuse('CONFIG_INVALID', ATTENDEE_NOT_ADDABLE);
      const setup = await personSetup(tx);
      if (setup === undefined) throw refuse('CONFIG_INVALID', ATTENDEE_NOT_ADDABLE);
      // Someone made them since the meeting synced: not a second person.
      const held = (await holders(tx, [setup.email.id], [email])).get(email) ?? [];
      if (held.length > 0) throw refuse('CONFIG_INVALID', ATTENDEE_NOT_ADDABLE);
      let companyId = await companyFor(tx, setup, email, options.isFreeDomain);
      if (companyId !== undefined && setup.companies !== undefined && !isOpen(scope.access)) {
        const seen = await visibleRecords(tx, scope.access, [{ objectId: setup.companies, recordId: companyId }]);
        if (!seen.has(companyId)) companyId = undefined;
      }
      const personId = await makePerson(
        context,
        setup,
        { email, ...(row.name === null ? {} : { name: row.name }) },
        companyId,
      );
      context.record({ meetings: await linkEmail(tx, email, personId) });
      return { recordId: personId };
    },
    hooks,
  );
  return result;
}

/** The workspace's calendar settings, and whether the reader may change them. */
export async function readCalendarSettings(scope: EngineScope): Promise<CalendarSettingsView> {
  checkScope(scope);
  return inWorkspace(scope, async (tx) => ({
    createUnknownPeople: await createsUnknownPeople(tx),
    canManage: can(scope.access, 'workspace.manage'),
  }));
}

/** Changes the workspace's calendar settings (owners and admins): making people for unknown attendees. */
export async function updateCalendarSettings(
  scope: EngineScope,
  input: { readonly createUnknownPeople: boolean },
  hooks: readonly AfterWrite[] = [],
): Promise<CalendarSettingsView> {
  requirePermission(scope, 'workspace.manage');
  const { principal } = scope.access;
  if (principal.kind !== 'member') throw refuse('FORBIDDEN', 'Calendar settings are changed by members.');
  const memberId = principal.memberId;
  await runWrite(
    scope,
    async ({ tx }) => {
      await tx.execute(sql`
        insert into calendar_settings (workspace_id, create_unknown_people, created_by_type, created_by_id,
          created_by_member_id, updated_by_type, updated_by_id, updated_by_member_id)
        values (${scope.workspaceId}::uuid, ${input.createUnknownPeople}, 'member', ${memberId}::uuid,
          ${memberId}::uuid, 'member', ${memberId}::uuid, ${memberId}::uuid)
        on conflict (workspace_id) do update set create_unknown_people = excluded.create_unknown_people,
          updated_at = now(), updated_by_type = 'member', updated_by_id = excluded.updated_by_id,
          updated_by_member_id = excluded.updated_by_member_id
      `);
    },
    hooks,
  );
  return { createUnknownPeople: input.createUnknownPeople, canManage: true };
}
