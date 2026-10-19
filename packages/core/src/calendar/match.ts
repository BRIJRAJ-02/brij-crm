// Matching a meeting's attendees to the CRM (spec 0024, AC-605 to AC-607):
// which events sync at all, which attendees are members, which are one
// person (by the People object's email addresses), and which company an
// external attendee's domain names. The lookups run as the system (the sync
// reads every record, as the `calendar` actor's system scope); what a reader
// later sees of them goes through the access door. The decisions themselves
// are pure, so they test without a database.
import { sql, type SQL } from 'drizzle-orm';
import type { WorkspaceTx } from '@crm/db';
import { uuidList } from '../engine/ids.ts';
import { normaliseEmail, type ProviderAttendee, type ProviderEvent, type ProviderResponse } from './provider.ts';

/**
 * Strings as one `text[]` parameter (a JSON array unpacked in SQL): drizzle
 * spreads a JS array into one parameter per item, and an empty one into `()`.
 */
export function textList(values: readonly string[]): SQL {
  return sql`array(select jsonb_array_elements_text(${JSON.stringify(values)}::jsonb))`;
}

/** How an attendee matched: one person, several, nobody, or a workspace member. */
export type AttendeeMatch = 'linked' | 'ambiguous' | 'unknown' | 'member';

/** One attendee row as stored. */
export interface AttendeeRow {
  readonly email: string;
  readonly name: string | null;
  readonly position: number;
  readonly response: ProviderResponse;
  readonly isOrganizer: boolean;
  readonly memberId: string | null;
  readonly personRecordId: string | null;
  readonly match: AttendeeMatch;
}

/** A record a meeting shows on, and why. */
export interface MeetingLink {
  readonly recordId: string;
  readonly via: 'attendee' | 'domain';
}

/** What the lookups found for a batch's emails and domains. */
export interface Lookups {
  /** Active members by email. */
  readonly members: ReadonlyMap<string, string>;
  /** Live people holding each email (one id: linked; several: ambiguous). */
  readonly people: ReadonlyMap<string, readonly string[]>;
  /** Live companies holding each domain (exactly one links). */
  readonly companies: ReadonlyMap<string, readonly string[]>;
  readonly isFreeDomain: (domain: string) => boolean;
}

/** The most attendees one meeting keeps (a large invite's first ones, organiser included). */
export const MAX_ATTENDEES = 200;

/** The longest attendee name kept. */
const NAME_MAX = 320;

/** An email's domain, lower case; undefined for an address with none. */
export function domainOf(email: string): string | undefined {
  const at = email.lastIndexOf('@');
  if (at < 1 || at === email.length - 1) return undefined;
  return email.slice(at + 1).toLowerCase();
}

/** A plausible address to store and match: something before and after one `@`, 3 to 320 characters. */
const isAddress = (email: string) => email.length >= 3 && email.length <= 320 && domainOf(email) !== undefined;

/**
 * Whether an event syncs at all (AC-605): never a cancelled one, nor one the
 * connected account declined, nor one with no attendee but the account
 * itself (an all day event with no attendees included).
 */
export function shouldSync(event: ProviderEvent): boolean {
  if (event.status === 'cancelled') return false;
  if (event.icalUid === undefined || event.start === undefined || event.end === undefined) return false;
  if (event.attendees.some((attendee) => attendee.isSelf && attendee.response === 'declined')) return false;
  return event.attendees.some((attendee) => !attendee.isSelf && isAddress(normaliseEmail(attendee.email)));
}

/** An event's attendees, each once by email (the first listing wins), the organiser kept, at most `MAX_ATTENDEES`. */
function uniqueAttendees(event: ProviderEvent): readonly ProviderAttendee[] {
  const seen = new Set<string>();
  const kept: ProviderAttendee[] = [];
  // The organiser and the account first, so a long list never cuts them.
  const ordered = [
    ...event.attendees.filter((each) => each.isOrganizer || each.isSelf),
    ...event.attendees.filter((each) => !each.isOrganizer && !each.isSelf),
  ];
  for (const attendee of ordered) {
    const email = normaliseEmail(attendee.email);
    if (!isAddress(email) || seen.has(email)) continue;
    seen.add(email);
    kept.push({ ...attendee, email });
    if (kept.length === MAX_ATTENDEES) break;
  }
  return kept;
}

/**
 * Every email and external domain a batch's events name, for the lookups:
 * emails lower case, domains only when not a free email domain.
 */
export function lookupKeys(
  events: readonly ProviderEvent[],
  isFreeDomain: (domain: string) => boolean,
): { readonly emails: readonly string[]; readonly domains: readonly string[] } {
  const emails = new Set<string>();
  const domains = new Set<string>();
  for (const event of events) {
    for (const attendee of uniqueAttendees(event)) {
      emails.add(attendee.email);
      const domain = domainOf(attendee.email);
      if (domain !== undefined && !isFreeDomain(domain)) domains.add(domain);
    }
  }
  return { emails: [...emails], domains: [...domains] };
}

/**
 * One event's attendees as stored, whether it is internal, and the records it
 * shows on (AC-605 to AC-607):
 * - the connected account itself is its member, whatever its address;
 * - a member's email makes a `member` attendee;
 * - exactly one live person holding the email links that person (`linked`);
 *   several link none (`ambiguous`); none is `unknown`;
 * - an attendee who is no member, at a domain that is no free email domain,
 *   links the one live company holding that domain, when exactly one does.
 * An internal meeting (every attendee a member) shows on no record.
 */
export function matchEvent(
  event: ProviderEvent,
  connectionMemberId: string,
  lookups: Lookups,
): {
  readonly attendees: readonly AttendeeRow[];
  readonly isInternal: boolean;
  readonly links: readonly MeetingLink[];
} {
  const attendees = uniqueAttendees(event).map((attendee, position): AttendeeRow => {
    const memberId = attendee.isSelf ? connectionMemberId : lookups.members.get(attendee.email);
    const people = memberId === undefined ? (lookups.people.get(attendee.email) ?? []) : [];
    const [only] = people;
    const match: AttendeeMatch =
      memberId !== undefined
        ? 'member'
        : people.length === 1 && only !== undefined
          ? 'linked'
          : people.length > 1
            ? 'ambiguous'
            : 'unknown';
    const name = attendee.name?.trim().slice(0, NAME_MAX);
    return {
      email: attendee.email,
      name: name === undefined || name === '' ? null : name,
      position,
      response: attendee.response,
      isOrganizer: attendee.isOrganizer,
      memberId: memberId ?? null,
      personRecordId: match === 'linked' ? (only ?? null) : null,
      match,
    };
  });
  const isInternal = attendees.length > 0 && attendees.every((attendee) => attendee.match === 'member');
  if (isInternal) return { attendees, isInternal, links: [] };
  const links = new Map<string, MeetingLink>();
  for (const attendee of attendees) {
    if (attendee.personRecordId !== null)
      links.set(attendee.personRecordId, { recordId: attendee.personRecordId, via: 'attendee' });
  }
  for (const attendee of attendees) {
    if (attendee.match === 'member') continue;
    const domain = domainOf(attendee.email);
    if (domain === undefined || lookups.isFreeDomain(domain)) continue;
    const companies = lookups.companies.get(domain) ?? [];
    const [company] = companies;
    if (companies.length === 1 && company !== undefined && !links.has(company)) {
      links.set(company, { recordId: company, via: 'domain' });
    }
  }
  return { attendees, isInternal, links: [...links.values()] };
}

/** The People object's email addresses attributes and the Companies object's domains, live (the standard template's). */
async function matchAttributes(
  tx: WorkspaceTx,
): Promise<{ readonly emails: readonly string[]; readonly domains: readonly string[] }> {
  const rows = await tx.execute<{ standard_key: string; id: string }>(sql`
    select o.standard_key, a.id::text as id
    from attributes a join objects o on o.workspace_id = a.workspace_id and o.id = a.object_id
    where o.archived_at is null and a.archived_at is null and (
      (o.standard_key = 'people' and a.api_slug = 'email_addresses' and a.type = 'email')
      or (o.standard_key = 'companies' and a.api_slug = 'domains' and a.type = 'domain'))
  `);
  return {
    emails: rows.rows.filter((row) => row.standard_key === 'people').map((row) => row.id),
    domains: rows.rows.filter((row) => row.standard_key === 'companies').map((row) => row.id),
  };
}

/** The live records holding each of `keys` in one of `attributeIds` (current values, through `values_text`). */
async function holders(
  tx: WorkspaceTx,
  attributeIds: readonly string[],
  keys: readonly string[],
): Promise<ReadonlyMap<string, readonly string[]>> {
  const found = new Map<string, string[]>();
  if (attributeIds.length === 0 || keys.length === 0) return found;
  const rows = await tx.execute<{ key: string; record_id: string }>(sql`
    select distinct lower(v.text_value) as key, v.record_id::text as record_id
    from "values" v join records r on r.workspace_id = v.workspace_id and r.id = v.record_id
    where v.attribute_id = any(${uuidList(attributeIds)}) and v.active_until is null and not v.is_cleared
      and v.text_value is not null and v.record_id is not null
      and (lower(left(v.text_value, 256)) collate "und-x-icu") = any(${textList(keys)})
      and lower(v.text_value) = any(${textList(keys)})
      and r.deleted_at is null
  `);
  for (const row of rows.rows) found.set(row.key, [...(found.get(row.key) ?? []), row.record_id]);
  return found;
}

/** The lookups one batch needs: its emails' members and people, and its domains' companies. */
export async function readLookups(
  tx: WorkspaceTx,
  events: readonly ProviderEvent[],
  isFreeDomain: (domain: string) => boolean,
): Promise<Lookups> {
  const { emails, domains } = lookupKeys(events, isFreeDomain);
  const attributes = await matchAttributes(tx);
  const members = new Map<string, string>();
  if (emails.length > 0) {
    const rows = await tx.execute<{ id: string; email: string }>(sql`
      select id::text as id, lower(email) as email from members
      where status = 'active' and lower(email) = any(${textList(emails)})
    `);
    for (const row of rows.rows) members.set(row.email, row.id);
  }
  const [people, companies] = [
    await holders(tx, attributes.emails, emails),
    await holders(tx, attributes.domains, domains),
  ];
  return { members, people, companies, isFreeDomain };
}
