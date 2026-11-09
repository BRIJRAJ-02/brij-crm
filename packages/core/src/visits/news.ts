// News and offers on a table reservation, by double opt-in (9 November 2026, migration 0202). A guest who ticks the
// box is asked to confirm by email: the tick is kept as a request (`consent_requests`), never as a consent, and the
// guest gets a signed link. Only the guest confirming on the page it opens writes the consent (`consent_records`,
// granted, source `appointment` and the visit), so a request never counts anywhere a consent is read: every reader
// reads `consent_records`, and nothing here is in it until then.
//
// The link's token is a signed value (`calendar/signing.ts`) under a key derived from the reservation link key, its
// own purpose and version, naming the workspace and the request and nothing else, for `NEWS_LINK_DAYS`. It is never
// stored. It confirms once: the request's `confirmed_at` is set in the same statement that checks it is still open
// and unexpired, so a second press, a replay or a race answers `already` and writes nothing more. Confirming is the
// inbox owner saying yes, so it grants even over a withdrawal the Person has: that is exactly what a typed email on
// a public page could never do on its own.
import { sql } from 'drizzle-orm';
import type { ConsentPurpose } from '@crm/contracts';
import type { WorkspaceTx } from '@crm/db';
import type { TableEntry } from '../access/table-door.ts';
import { inWorkspace } from '../access/run.ts';
import type { ManageLinkKey } from '../booking/tokens.ts';
import { deriveKey, signValue, verifyValue } from '../calendar/signing.ts';
import { queueEmail } from '../emails/queue.ts';
import { refuse } from '../engine/refusals.ts';

/** How long a news and offers link works: a week from the reservation. */
export const NEWS_LINK_DAYS = 7;

/** The signed value's version: a token made for anything else never reads as this one. */
const VERSION = 'rn1';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** What a news link names: the workspace, the place whose page confirms it, and the request. */
export interface NewsLink {
  readonly workspaceId: string;
  readonly placeId: string;
  readonly requestId: string;
}

/** The key news links are signed with, derived for this one purpose from the reservation link key. */
const keyOf = (linkKey: ManageLinkKey): Buffer => deriveKey(linkKey, 'reservation-news');

/** A request's link token, dated by when the request was made, so it runs out with the request. */
export function newsLinkToken(linkKey: ManageLinkKey, link: NewsLink, issuedAt: Date): string {
  return signValue(
    keyOf(linkKey),
    VERSION,
    { w: link.workspaceId, p: link.placeId, q: link.requestId },
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
  const { w, p, q } = payload;
  const ids = [w, p, q];
  if (!ids.every((id): id is string => typeof id === 'string' && UUID.test(id))) return undefined;
  return { workspaceId: ids[0] ?? '', placeId: ids[1] ?? '', requestId: ids[2] ?? '' };
}

/** The confirm page's path for a request: the reservation page's own, the token in the fragment. */
export function newsConfirmPath(placeKey: string, token: string): string {
  return `/r/${encodeURIComponent(placeKey)}/manage#${new URLSearchParams({ news: token }).toString()}`;
}

/** What asking came to: emailed, already asked for this visit, or not needed (the Person already said yes). */
export type NewsAsked = 'emailed' | 'asked_before' | 'already_given' | 'no_key';

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
  const token = newsLinkToken(
    input.linkKey,
    { workspaceId: input.workspaceId, placeId: input.placeId, requestId: row.id },
    new Date(row.requested_at),
  );
  await queueEmail(tx, {
    kind: 'reservation_news',
    ids: [row.id],
    to: { address: input.email },
    params: {
      business: input.business.slice(0, 200),
      confirmPath: newsConfirmPath(input.placeKey, token),
      expiresAt: new Date(row.expires_at).toISOString(),
      timeZone: input.timeZone,
    },
  });
  return 'emailed';
}

/** What confirming came to: saved now, or saved before (a second press). */
export type NewsConfirmed = 'confirmed' | 'already';

const GONE = (): Error => refuse('NOT_FOUND', 'This link no longer works. It may have expired.');

/**
 * Confirms the request a news link names (the guest pressed Yes on the page it opened), through the reservation
 * page's door: the token must name this page's workspace and place. Writes the consent once, in the transaction that
 * marks the request confirmed, and only while its Person is live (not deleted); a request already confirmed answers
 * `already` while the Person's latest consent for the purpose is still that yes. An unknown, expired or foreign
 * token, a request that ran out or was erased, a deleted Person, or one confirmed and since withdrawn, is the one
 * NOT_FOUND: an old link never says yes over a later no.
 */
export async function confirmNews(
  entry: TableEntry,
  deps: { readonly linkKey: ManageLinkKey; readonly now?: () => Date },
  token: string,
): Promise<NewsConfirmed> {
  const link = readNewsLinkToken(deps.linkKey, token, deps.now?.() ?? new Date());
  if (link?.workspaceId !== entry.scope.workspaceId || link.placeId !== entry.placeId) throw GONE();
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
      const before = await tx.execute<{ standing: boolean }>(sql`
        select q.confirmed_at is not null and coalesce((
          select c.granted from consent_records c
          where c.record_id = q.record_id and c.purpose = q.purpose
          order by c.at desc, c.id desc limit 1
        ), false) as standing
        from consent_requests q where q.id = ${link.requestId}::uuid
      `);
      if (before.rows[0]?.standing === true) return 'already';
      throw GONE();
    }
    // Only the columns the app may insert (migration 0165): `id` and `at` are the database's own.
    await tx.execute(sql`
      insert into consent_records
        (workspace_id, record_id, purpose, granted, wording, wording_version, source_type, source_id)
      values (nullif(current_setting('app.workspace_id', true), '')::uuid, ${row.record_id}::uuid, ${row.purpose},
        true, ${row.wording}, 1, ${row.source_type}, ${row.source_id}::uuid)
    `);
    return 'confirmed';
  });
}
