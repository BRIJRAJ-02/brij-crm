// News and offers on a table reservation, by double opt-in (9 November 2026, migration 0202). A guest who ticks the
// box is asked to confirm by email: the tick is kept as a request (`consent_requests`), never as a consent, and the
// guest gets a signed link. Only the guest confirming on the page it opens writes the consent (`consent_records`,
// granted, source `appointment` and the visit), so a request never counts anywhere a consent is read: every reader
// reads `consent_records`, and nothing here is in it until then.
//
// The link's token is a signed value (`calendar/signing.ts`) under a key derived from the reservation link key, its
// own purpose and version, naming the workspace, the place, the request and a hash of the address it went to, for
// `NEWS_LINK_DAYS`. It is never stored. It confirms once: the request's `confirmed_at` is set in the same statement
// that checks it is still open and unexpired, so a second press, a replay or a race answers `already` and writes
// nothing more. Confirming is the inbox owner saying yes, so it grants even over a withdrawal the Person has: that is
// exactly what a typed email on a public page could never do on its own.
//
// Unsubscribing (10 November 2026, migration 0204; GDPR, CAN-SPAM, and the Gmail and Yahoo bulk sender rules): every
// email here carries a way out, the footer's Unsubscribe link and RFC 8058's one click headers, and so will every
// marketing email a business sends its guests (`MARKETING_EMAIL_KINDS`). Its token is signed under a key of its own
// and version `nu1`, names the workspace, the place, the Person, the purpose and a keyed hash of the address (never
// the address: the one click carries it in a query, which request logs keep), and never runs out, as unsubscribe
// links don't. Withdrawing writes a new `consent_records` row saying no (source `email_link`), only when the latest
// row doesn't already, so a repeat writes nothing. Subscribing again never grants: it asks through the double opt-in
// once more, one request per withdrawal, sent only to an address the Person still holds whose hash the token names.
// Every answer is the same whatever was or wasn't done, so no link says whether an address is on a list.
import { createHmac } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { CONSENT_PURPOSES, type ConsentPurpose } from '@crm/contracts';
import { GUEST_UNSUBSCRIBE_PATH, type GuestUnsubscribe } from '@crm/contracts/emails';
import type { WorkspaceTx } from '@crm/db';
import type { TableEntry } from '../access/table-door.ts';
import { inWorkspace } from '../access/run.ts';
import type { ManageLinkKey } from '../booking/tokens.ts';
import { deriveKey, signValue, verifyValue } from '../calendar/signing.ts';
import { queueEmail } from '../emails/queue.ts';
import { refuse } from '../engine/refusals.ts';

/** How long a news and offers link works: a week from the reservation. */
export const NEWS_LINK_DAYS = 7;

/** The wording a guest ticks for news and offers, stored with the request and the consent (version 1). */
export const newsWording = (business: string): string => `Send me news and offers from ${business}.`;

/** The words a withdrawal is stored with: the unsubscribe page's own question. */
export const newsWithdrawalWording = (business: string): string => `Unsubscribe from news and offers from ${business}.`;

/** A withdrawal's words once the place that sent the link is gone. */
const NEWS_WITHDRAWAL_PLAIN = 'Unsubscribe from news and offers.';

/** The signed value's version: a token made for anything else never reads as this one. */
const VERSION = 'rn1';

/** The unsubscribe token's version, apart from the confirm's: neither ever reads as the other. */
const UNSUBSCRIBE_VERSION = 'nu1';

/** An unsubscribe link never runs out (industry standard): a hundred years stands in for never. */
const UNSUBSCRIBE_SECONDS = 100 * 365 * 86_400;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ADDRESS_HASH = /^[A-Za-z0-9_-]{22}$/;

/** What a news link names: the workspace, the place whose page confirms it, the request, and the address's hash. */
export interface NewsLink {
  readonly workspaceId: string;
  readonly placeId: string;
  readonly requestId: string;
  /** `newsAddressHash` of the address the link went to; absent on a link made before 10 November 2026. */
  readonly addressHash?: string;
}

/** What an unsubscribe link names: the workspace, the place that sent it, the Person, the purpose and the address. */
export interface NewsUnsubscribeLink {
  readonly workspaceId: string;
  readonly placeId: string;
  readonly recordId: string;
  readonly purpose: ConsentPurpose;
  readonly addressHash: string;
}

/** The key news links are signed with, derived for this one purpose from the reservation link key. */
const keyOf = (linkKey: ManageLinkKey): Buffer => deriveKey(linkKey, 'reservation-news');

/** The key unsubscribe links are signed with, and the one addresses are hashed with: each its own purpose. */
const unsubscribeKeyOf = (linkKey: ManageLinkKey): Buffer => deriveKey(linkKey, 'news-unsubscribe');
const addressKeyOf = (linkKey: ManageLinkKey): Buffer => deriveKey(linkKey, 'news-unsubscribe-address');

/** An address as a link names it: a keyed hash of it, lower cased, so no token ever holds the address itself. */
export function newsAddressHash(linkKey: ManageLinkKey, email: string): string {
  return createHmac('sha256', addressKeyOf(linkKey))
    .update(email.trim().toLowerCase())
    .digest('base64url')
    .slice(0, 22);
}

/** A request's link token, dated by when the request was made, so it runs out with the request. */
export function newsLinkToken(linkKey: ManageLinkKey, link: NewsLink, issuedAt: Date): string {
  return signValue(
    keyOf(linkKey),
    VERSION,
    {
      w: link.workspaceId,
      p: link.placeId,
      q: link.requestId,
      ...(link.addressHash === undefined ? {} : { a: link.addressHash }),
    },
    NEWS_LINK_DAYS * 86_400,
    issuedAt,
  );
}

/** The request a token names, or undefined for anything not ours, expired or malformed. Never throws. */
export function readNewsLinkToken(
  linkKey: ManageLinkKey,
  token: string | undefined,
  now: Date = new Date(),
): NewsLink | undefined {
  const payload = verifyValue(keyOf(linkKey), VERSION, token, now);
  if (payload === undefined) return undefined;
  const { w, p, q, a } = payload;
  const ids = [w, p, q];
  if (!ids.every((id): id is string => typeof id === 'string' && UUID.test(id))) return undefined;
  const addressHash = typeof a === 'string' && ADDRESS_HASH.test(a) ? a : undefined;
  return {
    workspaceId: ids[0] ?? '',
    placeId: ids[1] ?? '',
    requestId: ids[2] ?? '',
    ...(addressHash === undefined ? {} : { addressHash }),
  };
}

/** An unsubscribe link's token: no expiry, bound to the workspace, the place, the Person, the purpose and address. */
export function newsUnsubscribeToken(
  linkKey: ManageLinkKey,
  link: NewsUnsubscribeLink,
  now: Date = new Date(),
): string {
  return signValue(
    unsubscribeKeyOf(linkKey),
    UNSUBSCRIBE_VERSION,
    { w: link.workspaceId, p: link.placeId, r: link.recordId, u: link.purpose, a: link.addressHash },
    UNSUBSCRIBE_SECONDS,
    now,
  );
}

const isPurpose = (value: unknown): value is ConsentPurpose =>
  typeof value === 'string' && (CONSENT_PURPOSES as readonly string[]).includes(value);

/** What an unsubscribe token names, or undefined for anything not ours or malformed. Never throws. */
export function readNewsUnsubscribeToken(
  linkKey: ManageLinkKey,
  token: string | undefined,
  now: Date = new Date(),
): NewsUnsubscribeLink | undefined {
  const payload = verifyValue(unsubscribeKeyOf(linkKey), UNSUBSCRIBE_VERSION, token, now);
  if (payload === undefined) return undefined;
  const { w, p, r, u, a } = payload;
  const ids = [w, p, r];
  if (!ids.every((id): id is string => typeof id === 'string' && UUID.test(id))) return undefined;
  if (!isPurpose(u) || typeof a !== 'string' || !ADDRESS_HASH.test(a)) return undefined;
  return { workspaceId: ids[0] ?? '', placeId: ids[1] ?? '', recordId: ids[2] ?? '', purpose: u, addressHash: a };
}

/** The confirm page's path for a request: the reservation page's own, the token in the fragment. */
export function newsConfirmPath(placeKey: string, token: string): string {
  return `/r/${encodeURIComponent(placeKey)}/manage#${new URLSearchParams({ news: token }).toString()}`;
}

/** The one click unsubscribe's address (RFC 8058), under the app's `/api` base path. */
export const NEWS_UNSUBSCRIBE_PATH = GUEST_UNSUBSCRIBE_PATH;

/** The page that asks before it unsubscribes, on the place's own reservation page, its token in the fragment. */
export function newsUnsubscribePagePath(placeKey: string, token: string): string {
  return `/r/${encodeURIComponent(placeKey)}/manage#${new URLSearchParams({ unsubscribe: token }).toString()}`;
}

/**
 * An email's way out (`GuestUnsubscribe`): the footer's page and the one click address, one token for both. The one
 * click's address holds no place key, so it keeps working if the place's page moves to a new key.
 */
export function newsUnsubscribeParts(placeKey: string, token: string): GuestUnsubscribe {
  return {
    pagePath: newsUnsubscribePagePath(placeKey, token),
    oneClickPath: `${NEWS_UNSUBSCRIBE_PATH}?${new URLSearchParams({ t: token }).toString()}`,
  };
}

/** What asking came to: emailed, already asked for this visit, or not needed (the Person already said yes). */
export type NewsAsked = 'emailed' | 'asked_before' | 'already_given' | 'no_key';

/** Queues the double opt-in email for a request just made, with its confirm link and its way out. */
async function queueNewsEmail(
  tx: WorkspaceTx,
  input: {
    readonly workspaceId: string;
    readonly placeId: string;
    readonly recordId: string;
    readonly purpose: ConsentPurpose;
    readonly business: string;
    readonly email: string;
    readonly placeKey: string;
    readonly timeZone: string;
    readonly linkKey: ManageLinkKey;
    readonly request: { readonly id: string; readonly requested_at: Date | string; readonly expires_at: Date | string };
  },
): Promise<void> {
  const addressHash = newsAddressHash(input.linkKey, input.email);
  const token = newsLinkToken(
    input.linkKey,
    { workspaceId: input.workspaceId, placeId: input.placeId, requestId: input.request.id, addressHash },
    new Date(input.request.requested_at),
  );
  const unsubscribe = newsUnsubscribeToken(input.linkKey, {
    workspaceId: input.workspaceId,
    placeId: input.placeId,
    recordId: input.recordId,
    purpose: input.purpose,
    addressHash,
  });
  await queueEmail(tx, {
    kind: 'reservation_news',
    ids: [input.request.id],
    to: { address: input.email },
    params: {
      business: input.business.slice(0, 200),
      confirmPath: newsConfirmPath(input.placeKey, token),
      expiresAt: new Date(input.request.expires_at).toISOString(),
      timeZone: input.timeZone,
      unsubscribe: newsUnsubscribeParts(input.placeKey, unsubscribe),
    },
  });
}

/**
 * Keeps a ticked news box as a request and queues its email, in the caller's transaction (the visit's workspace):
 * nothing when the Person's latest consent for the purpose already says yes, one request per visit and purpose (a
 * retry asks nothing more), and without a link key (tests) the request with no email.
 */
export async function askForNews(
  tx: WorkspaceTx,
  input: {
    readonly workspaceId: string;
    readonly placeId: string;
    readonly recordId: string;
    readonly appointmentId: string;
    readonly purpose: ConsentPurpose;
    readonly wording: string;
    readonly business: string;
    readonly email: string;
    readonly placeKey: string;
    readonly timeZone: string;
    readonly linkKey?: ManageLinkKey | undefined;
  },
): Promise<NewsAsked> {
  const latest = await tx.execute<{ granted: boolean }>(sql`
    select granted from consent_records
    where record_id = ${input.recordId}::uuid and purpose = ${input.purpose}
    order by at desc, id desc limit 1
  `);
  if (latest.rows[0]?.granted === true) return 'already_given';
  // The database's own clock for both times, so the row's check (`expires_at > requested_at`) always holds.
  const made = await tx.execute<{ id: string; requested_at: Date | string; expires_at: Date | string }>(sql`
    insert into consent_requests (workspace_id, record_id, purpose, wording, source_type, source_id, expires_at)
    values (${input.workspaceId}::uuid, ${input.recordId}::uuid, ${input.purpose}, ${input.wording.slice(0, 2000)},
      'appointment', ${input.appointmentId}::uuid, now() + make_interval(days => ${NEWS_LINK_DAYS}))
    on conflict (workspace_id, source_id, purpose) do nothing
    returning id::text as id, requested_at, expires_at
  `);
  const [row] = made.rows;
  if (row === undefined) return 'asked_before';
  if (input.linkKey === undefined) return 'no_key';
  await queueNewsEmail(tx, { ...input, linkKey: input.linkKey, request: row });
  return 'emailed';
}

/** What confirming came to: saved now, or saved before (a second press). */
export type NewsConfirmed = 'confirmed' | 'already';

/** What confirming came to, with the unsubscribe token the signed up page links ("Changed your mind?"). */
export interface NewsConfirmation {
  readonly status: NewsConfirmed;
  /** Absent for a link made before 10 November 2026, which names no address. */
  readonly unsubscribeToken?: string;
}

const GONE = (): Error => refuse('NOT_FOUND', 'This link no longer works. It may have expired.');

/**
 * Confirms the request a news link names (the guest pressed Yes on the page it opened), through the reservation
 * page's door: the token must name this page's workspace and place. Writes the consent once, in the transaction that
 * marks the request confirmed, and only while its Person is live (not deleted); a request already confirmed answers
 * `already` while the Person's latest consent for the purpose is still that yes. An unknown, expired or foreign
 * token, a request that ran out or was erased, a deleted Person, or one confirmed and since withdrawn, is the one
 * NOT_FOUND: an old link never says yes over a later no. Answers with the unsubscribe token for the same Person.
 */
export async function confirmNewsLink(
  entry: TableEntry,
  deps: { readonly linkKey: ManageLinkKey; readonly now?: () => Date },
  token: string,
): Promise<NewsConfirmation> {
  const now = deps.now?.() ?? new Date();
  const link = readNewsLinkToken(deps.linkKey, token, now);
  if (link?.workspaceId !== entry.scope.workspaceId || link.placeId !== entry.placeId) throw GONE();
  const withLink = (status: NewsConfirmed, recordId: string, purpose: string): NewsConfirmation =>
    link.addressHash === undefined || !isPurpose(purpose)
      ? { status }
      : {
          status,
          unsubscribeToken: newsUnsubscribeToken(
            deps.linkKey,
            { workspaceId: link.workspaceId, placeId: link.placeId, recordId, purpose, addressHash: link.addressHash },
            now,
          ),
        };
  return inWorkspace(entry.scope, async (tx) => {
    const opened = await tx.execute<{
      record_id: string;
      purpose: string;
      wording: string;
      source_type: string;
      source_id: string;
    }>(sql`
      update consent_requests set confirmed_at = now()
      where id = ${link.requestId}::uuid and confirmed_at is null and expires_at > now()
        and exists (
          select 1 from records r
          where r.workspace_id = consent_requests.workspace_id and r.id = consent_requests.record_id
            and r.deleted_at is null
        )
      returning record_id::text, purpose, wording, source_type, source_id::text
    `);
    const [row] = opened.rows;
    if (row === undefined) {
      const before = await tx.execute<{ standing: boolean; record_id: string; purpose: string }>(sql`
        select q.confirmed_at is not null and coalesce((
          select c.granted from consent_records c
          where c.record_id = q.record_id and c.purpose = q.purpose
          order by c.at desc, c.id desc limit 1
        ), false) as standing, q.record_id::text as record_id, q.purpose
        from consent_requests q where q.id = ${link.requestId}::uuid
      `);
      const [held] = before.rows;
      if (held?.standing === true) return withLink('already', held.record_id, held.purpose);
      throw GONE();
    }
    // Only the columns the app may insert (migration 0165): `id` and `at` are the database's own.
    await tx.execute(sql`
      insert into consent_records
        (workspace_id, record_id, purpose, granted, wording, wording_version, source_type, source_id)
      values (nullif(current_setting('app.workspace_id', true), '')::uuid, ${row.record_id}::uuid, ${row.purpose},
        true, ${row.wording}, 1, ${row.source_type}, ${row.source_id}::uuid)
    `);
    return withLink('confirmed', row.record_id, row.purpose);
  });
}

/** `confirmNewsLink`'s status alone. */
export async function confirmNews(
  entry: TableEntry,
  deps: { readonly linkKey: ManageLinkKey; readonly now?: () => Date },
  token: string,
): Promise<NewsConfirmed> {
  return (await confirmNewsLink(entry, deps, token)).status;
}

/** The place's business name, its key and its time zone, read in the entry's workspace. */
async function placeFacts(
  tx: WorkspaceTx,
  placeId: string,
): Promise<{ readonly business: string; readonly timeZone: string } | undefined> {
  const found = await tx.execute<{ name: string; business: string | null; time_zone: string }>(sql`
    select p.name, p.time_zone,
      (select b.name from properties b where b.workspace_id = p.workspace_id and b.id = p.property_id) as business
    from places p where p.id = ${placeId}::uuid
  `);
  const [row] = found.rows;
  return row === undefined ? undefined : { business: row.business ?? row.name, timeZone: row.time_zone };
}

/** One lock per Person and purpose for the length of the transaction, so two presses never race each other. */
const lockConsent = (tx: WorkspaceTx, workspaceId: string, recordId: string, purpose: string) =>
  tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`consent:${workspaceId}:${recordId}:${purpose}`}, 0))`,
  );

/**
 * The Person a link's record is now: the record itself, or the one it was merged into (a merge moves every consent
 * onto the Person kept, `engine/merge.ts`), followed at most 10 merges on. Undefined once it is erased.
 */
async function currentPerson(tx: WorkspaceTx, recordId: string): Promise<string | undefined> {
  const found = await tx.execute<{ id: string }>(sql`
    with recursive chain (id, merged_into, depth) as (
      select r.id, r.merged_into_record_id, 0 from records r where r.id = ${recordId}::uuid
      union all
      select r.id, r.merged_into_record_id, c.depth + 1
      from records r join chain c on r.id = c.merged_into
      where c.depth < 10
    )
    select id::text as id from chain order by depth desc limit 1
  `);
  return found.rows[0]?.id;
}

/** What a withdrawal came to: written now, or the latest row already said no (or the Person is gone). */
export type NewsWithdrawn = 'withdrawn' | 'unchanged';

/**
 * Withdraws the consent an unsubscribe link names, entered through `enterNewsPlace` for the link's own place: a new
 * `consent_records` row saying no (source `email_link`, the place's words, or plain ones once the place is gone),
 * onto the Person the record is now (a merged one's kept Person), only when their latest row for the purpose isn't
 * already no, so it is idempotent. A Person since erased writes nothing. The caller answers the same either way:
 * the outcome is for its log only, never the page.
 */
export async function withdrawNews(entry: TableEntry, link: NewsUnsubscribeLink): Promise<NewsWithdrawn> {
  if (link.workspaceId !== entry.scope.workspaceId || link.placeId !== entry.placeId) throw GONE();
  return inWorkspace(entry.scope, async (tx) => {
    const person = await currentPerson(tx, link.recordId);
    if (person === undefined) return 'unchanged';
    await lockConsent(tx, link.workspaceId, person, link.purpose);
    const facts = await placeFacts(tx, entry.placeId);
    const wording = facts === undefined ? NEWS_WITHDRAWAL_PLAIN : newsWithdrawalWording(facts.business);
    // Only the columns the app may insert (migration 0165): `id` and `at` are the database's own.
    const written = await tx.execute(sql`
      insert into consent_records
        (workspace_id, record_id, purpose, granted, wording, wording_version, source_type, source_id)
      select nullif(current_setting('app.workspace_id', true), '')::uuid, r.id, ${link.purpose}, false,
        ${wording.slice(0, 2000)}, 1, 'email_link', null
      from records r
      where r.id = ${person}::uuid
        and coalesce((
          select c.granted from consent_records c
          where c.record_id = r.id and c.purpose = ${link.purpose}
          order by c.at desc, c.id desc limit 1
        ), true)
    `);
    return (written.rowCount ?? 0) > 0 ? 'withdrawn' : 'unchanged';
  });
}

/** What subscribing again came to, for the caller's log only: emailed, or why nothing went. */
export type NewsResubscribed =
  'emailed' | 'already_given' | 'asked_before' | 'no_withdrawal' | 'no_address' | 'no_place';

/**
 * Subscribing again from an unsubscribe link (the "Subscribe again" on the unsubscribed page): never a consent, only
 * a new double opt-in request and its email, as a ticked box makes. It follows the Person's latest withdrawal (its
 * `source_id`), so one withdrawal asks once, and it goes only to a live address the Person (a merged one's kept
 * Person) still holds whose hash the link names: nobody holding a link can send the email anywhere else. Nothing when
 * the latest row already says yes, or the place that sent the link is gone (its page confirms the request).
 */
export async function resubscribeNews(
  entry: TableEntry,
  deps: { readonly linkKey: ManageLinkKey },
  link: NewsUnsubscribeLink,
): Promise<NewsResubscribed> {
  if (link.workspaceId !== entry.scope.workspaceId || link.placeId !== entry.placeId) throw GONE();
  if (entry.key === '') return 'no_place';
  return inWorkspace(entry.scope, async (tx) => {
    const person = await currentPerson(tx, link.recordId);
    if (person === undefined) return 'no_address';
    await lockConsent(tx, link.workspaceId, person, link.purpose);
    const latest = await tx.execute<{ id: string; granted: boolean }>(sql`
      select c.id::text as id, c.granted from consent_records c
      where c.record_id = ${person}::uuid and c.purpose = ${link.purpose}
      order by c.at desc, c.id desc limit 1
    `);
    const [last] = latest.rows;
    if (last?.granted === true) return 'already_given';
    if (last === undefined) return 'no_withdrawal';
    const addresses = await tx.execute<{ email: string }>(sql`
      select distinct lower(v.text_value) as email
      from "values" v
      join attributes a on a.workspace_id = v.workspace_id and a.id = v.attribute_id
        and a.api_slug = 'email_addresses' and a.archived_at is null
      join objects o on o.workspace_id = a.workspace_id and o.id = a.object_id and o.standard_key = 'people'
      join records r on r.workspace_id = v.workspace_id and r.id = v.record_id and r.deleted_at is null
      where v.record_id = ${person}::uuid and v.active_until is null and not v.is_cleared
        and v.text_value is not null
    `);
    const email = addresses.rows
      .map((row) => row.email)
      .find((address) => newsAddressHash(deps.linkKey, address) === link.addressHash);
    if (email === undefined) return 'no_address';
    const facts = await placeFacts(tx, entry.placeId);
    if (facts === undefined) return 'no_place';
    const made = await tx.execute<{ id: string; requested_at: Date | string; expires_at: Date | string }>(sql`
      insert into consent_requests (workspace_id, record_id, purpose, wording, source_type, source_id, expires_at)
      values (nullif(current_setting('app.workspace_id', true), '')::uuid, ${person}::uuid, ${link.purpose},
        ${newsWording(facts.business).slice(0, 2000)}, 'email_link', ${last.id}::uuid,
        now() + make_interval(days => ${NEWS_LINK_DAYS}))
      on conflict (workspace_id, source_id, purpose) do nothing
      returning id::text as id, requested_at, expires_at
    `);
    const [row] = made.rows;
    if (row === undefined) return 'asked_before';
    await queueNewsEmail(tx, {
      workspaceId: link.workspaceId,
      placeId: link.placeId,
      recordId: person,
      purpose: link.purpose,
      business: facts.business,
      email,
      placeKey: entry.key,
      timeZone: facts.timeZone,
      linkKey: deps.linkKey,
      request: row,
    });
    return 'emailed';
  });
}
