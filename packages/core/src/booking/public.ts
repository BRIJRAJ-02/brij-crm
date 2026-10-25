// The public booking page's services (spec 0025): the page's facts, its slots,
// and a visitor's booking. Each takes the entry `enterBookingPage` made from
// the public key, so a visitor reaches one page of one workspace and nothing
// else, and each answers only what AC-644 allows (no member email, no other
// booking, no busy event's title, no id but the page's public key).
//
// Booking, adapted from an earlier scheduling build's write path:
// 1. A retry of the same attempt (its idempotency key) answers the first booking.
// 2. The host's calendars are read OUTSIDE any lock (a network call never
//    holds a pooled connection's lock); a calendar refused until reconnect
//    fails closed.
// 3. One transaction holds an advisory lock per host (every required member,
//    in id order), recomputes that day's slots against the bookings it now
//    sees, and refuses SLOT_TAKEN unless the slot is still offered; then
//    inserts the booking (the exclusion constraint refuses an overlap anything
//    let through) and matches or makes the visitor's records under a lock on
//    their email, in a savepoint, so a record refusal never loses the booking.
// 4. After the commit, the calendar event (three tries); a booking whose event
//    failed stays confirmed and is marked for the host.
import { handoffSubmission, handoffVisitor } from '../forms/public.ts';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  bookingPicturePath,
  PROFILE_PAGE_SIZE,
  profilePicturePath,
  checkProfileLink,
  linkMarkOf,
  ProfileContactBlock,
  ProfileFaqBlock,
  ProfileTextBlock,
  PublicProfileItem,
  type ProfileContactCard,
  type PublicAddress,
  type PublicProfile,
} from '@crm/contracts';
import type {
  PublicBookInput,
  PublicBooking,
  PublicChatLine,
  PublicManagedBooking,
  PublicBookingPage,
  PublicLocation,
  PublicSlots,
  PublicSlotsQuery,
} from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import type { BookingEntry, HandleOwner, LinkPageRow, OwnedPageEntry } from '../access/door.ts';
import { pagePath } from './handles.ts';
import { servedPicture, type AccountPicture, type AccountPictureReader } from './picture.ts';
import { isPictureHidden } from './picture-choice.ts';
import { publicSocialsOf } from './socials.ts';
import { checkScope } from '../access/mint.ts';
import { inWorkspace } from '../access/run.ts';
import { postgresError, refuse, refuseOn } from '../engine/refusals.ts';
import { runWrite, type AfterWrite } from '../engine/write.ts';
import type { BookingCalendar, BusyReader } from './calendar.ts';
import {
  BUSY_MARGIN_MS,
  bookedSpans,
  loadPage,
  membersBusy,
  membersClosed,
  membersOf,
  pageSlots,
  pickHost,
  type MembersBusy,
  type PageRecord,
} from './slots.ts';
import { lockKey } from './locks.ts';
import { chooseHosts, lockHosts, lockRotations, SLOT_TAKEN_MESSAGE, type ChosenHosts } from '../rotation/assign.ts';
import { writeAssignment } from '../rotation/ledger.ts';
import { loadTeam, memberBusy, readTeam, teamMemberIds, teamSlots, type Team } from '../rotation/team.ts';
import { buildBookingIcs } from './ics.ts';
import { matchVisitor } from './visitor.ts';
import { MAX_RESCHEDULES } from './change.ts';
import {
  allowFor,
  handoffHosts,
  narrowTeam,
  recordBookingRouting,
  routeBooking,
  type BookingRouting,
} from '../routing/booking.ts';
import { enqueueBookingMail, recordEvent } from './mail-queue.ts';
import { ensureManageToken, managePath, manageTokenFor, type ManageLinkKey } from './tokens.ts';

const { bookingHosts, bookingPages, bookings, members, workspaces } = schema;

/** What the public services need: the calendar calls, the manage link key, and the clock. */
export interface PublicBookingDeps {
  readonly calendar: BookingCalendar & { readonly busy: BusyReader & { readonly fresh?: BusyReader } };
  /** Derives each booking's guest page token (`tokens.ts`). */
  readonly linkKey: ManageLinkKey;
  readonly now?: () => Date;
  /** Where a failed calendar event is reported (the booking itself stands). */
  readonly log?: { warn(message: string, fields: Readonly<Record<string, unknown>>): void };
}

/** Refuses an entry the door didn't make for this page. */
function checkEntry(entry: BookingEntry): void {
  checkScope(entry.scope);
  const { principal } = entry.scope.access;
  if (principal.kind !== 'booking' || principal.pageId !== entry.pageId) {
    throw new Error('Refused a booking entry the door did not make.');
  }
}

/** The page, live and taking bookings: deleted is "no longer available", paused is closed. */
async function livePage(tx: WorkspaceTx, entry: BookingEntry): Promise<PageRecord> {
  return liveOf(await loadPage(tx, entry.pageId));
}

/** `livePage` for a page already read, so a caller never reads it twice. */
function liveOf(page: PageRecord | undefined): PageRecord {
  if (page === undefined || page.isDeleted) throw refuse('NOT_FOUND', 'This page is no longer available.');
  if (page.status !== 'live') throw refuse('BOOKING_CLOSED', 'This page isn’t taking bookings right now.');
  return page;
}

/** Every host's name, in order, as one line ("Sam Lee and Kim Park"); a team booking's confirmation names them all. */
export async function hostNames(tx: WorkspaceTx, memberIds: readonly string[]): Promise<string> {
  if (memberIds.length === 0) return '';
  const rows = await tx
    .select({ id: members.id, name: members.name })
    .from(members)
    .where(inArray(members.id, [...memberIds]));
  const names = memberIds.map((id) => rows.find((row) => row.id === id)?.name ?? '').filter((name) => name !== '');
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`;
}

/** Who a booking names as its host: on a round robin page every host it occupies, organiser first; else its host. */
async function bookingHostName(
  tx: WorkspaceTx,
  page: Pick<PageRecord, 'kind'>,
  row: { readonly id: string; readonly hostMemberId: string },
): Promise<string> {
  if (page.kind !== 'round_robin') return hostName(tx, row.hostMemberId);
  const held = await tx
    .select({ memberId: bookingHosts.memberId })
    .from(bookingHosts)
    .where(eq(bookingHosts.bookingId, row.id));
  const others = held.map((each) => each.memberId).filter((id) => id !== row.hostMemberId);
  return hostNames(tx, [row.hostMemberId, ...others.sort()]);
}

/** The host's name as the workspace shows it, never their email. */
export async function hostName(tx: WorkspaceTx, memberId: string): Promise<string> {
  const [row] = await tx.select({ name: members.name }).from(members).where(eq(members.id, memberId));
  return row?.name ?? '';
}

/** The workspace's name, which hosts a team page before a host is chosen. */
async function workspaceName(tx: WorkspaceTx): Promise<string> {
  const [row] = await tx.select({ name: workspaces.name }).from(workspaces).limit(1);
  return row?.name ?? '';
}

/** The most team avatars the rail shows before "+N" (AC-733). */
const TEAM_AVATARS_MAX = 4;

/** A team page's avatar stack (AC-733): up to 4 of its members' initials, and how many more; no names, no emails. */
async function teamAvatars(tx: WorkspaceTx, team: Team): Promise<NonNullable<PublicBookingPage['team']>> {
  const ids = teamMemberIds(team);
  const rows =
    ids.length === 0
      ? []
      : await tx
          .select({ id: members.id, name: members.name })
          .from(members)
          .where(inArray(members.id, ids.slice(0, TEAM_AVATARS_MAX)));
  const names = new Map(rows.map((row) => [row.id, row.name]));
  return {
    avatars: ids.slice(0, TEAM_AVATARS_MAX).map((id) => ({ initials: initialsOf(names.get(id) ?? '') })),
    more: Math.max(0, ids.length - TEAM_AVATARS_MAX),
  };
}

/** Up to two initials of a name ("Sam Lee" is "SL"), upper case; none for an empty name. */
function initialsOf(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((word) => word !== '');
  const first = words[0]?.[0] ?? '';
  const last = words.length > 1 ? (words.at(-1)?.[0] ?? '') : '';
  return `${first}${last}`.toUpperCase();
}

/** The location a visitor may see. */
function publicLocation(page: PageRecord): PublicLocation {
  return page.location;
}

/** Reads account pictures (schema auth, through the identity login): the public page's host picture. */
export interface PublicPictureDeps {
  readonly pictureOf: AccountPictureReader;
}

/**
 * The page's facts for its public page (AC-644: no member email, no internal id). With `pictures`, a personal
 * page whose owner's account has a Google picture names our own path to it (`hostImage`), unless the owner keeps
 * it off their public pages (owner ask A124); a team page never does (AC-754). The picture is read after the
 * transaction, so no tenant connection waits on the identity login.
 */
export async function getPublicBookingPage(
  entry: BookingEntry,
  pictures?: PublicPictureDeps,
): Promise<PublicBookingPage> {
  checkEntry(entry);
  const { facts, pictureUser } = await inWorkspace(entry.scope, async (tx) => {
    const page = await livePage(tx, entry);
    const team = await loadTeam(tx, page);
    const path = await pagePath(tx, page);
    const facts: PublicBookingPage = {
      publicKey: page.publicKey,
      title: page.title,
      description: page.description,
      // A team page names no member before booking (AC-754): the workspace hosts it.
      hostName: team === undefined ? await hostName(tx, page.ownerMemberId) : await workspaceName(tx),
      durations: page.durations,
      location: publicLocation(page),
      hostTimeZone: page.availability.timeZone,
      windowDays: page.windowDays,
      // The view the host chose, beside the rest of the facts, so the page's first paint is already that view.
      defaultView: page.defaultView,
      ...(team === undefined ? {} : { team: await teamAvatars(tx, team) }),
      // Once the owner has a handle, a plain `/b/<key>` visit moves to `/<handle>/<slug>`.
      ...(path.startsWith('/b/') ? {} : { path }),
      ...(team === undefined ? await shownSocials(tx, page) : {}),
    };
    return { facts, pictureUser: pictures === undefined ? undefined : await shownPictureOwner(tx, page) };
  });
  if (pictures === undefined || pictureUser === undefined) return facts;
  const picture = servedPicture(pictureUser, await pictures.pictureOf(pictureUser));
  return picture === undefined ? facts : { ...facts, hostImage: bookingPicturePath(facts.publicKey, picture.version) };
}

/**
 * The host's social links on a page (booking socials, 25 Oct 2026): a personal page's owner's, while its "Show my
 * social links" is on and they have any. A team page, or a kind yet to come, names no member (AC-754).
 */
async function shownSocials(
  tx: WorkspaceTx,
  page: PageRecord,
): Promise<{ readonly socials?: PublicBookingPage['socials'] }> {
  const owner = page.kind === 'personal' && page.showSocials ? (page.ownerUserId ?? undefined) : undefined;
  if (owner === undefined) return {};
  const socials = await publicSocialsOf(tx, owner);
  return socials.length === 0 ? {} : { socials: [...socials] };
}

/**
 * Whose picture a page shows: a personal page's owner, unless they keep it off their public pages (owner ask A124:
 * the page then shows initials, and its picture route answers as for a person with none); a team page, or a kind
 * yet to come, names no member (AC-754). Asked in the page's own transaction, before any read of the picture.
 */
async function shownPictureOwner(tx: WorkspaceTx, page: PageRecord): Promise<string | undefined> {
  const owner = page.kind === 'personal' ? (page.ownerUserId ?? undefined) : undefined;
  return owner === undefined || (await isPictureHidden(tx, owner)) ? undefined : owner;
}

/**
 * A personal page's host picture to serve (23 Oct 2026): the owner's account picture, when it is one of Google's
 * (`servedPicture`) and they show it, else undefined; a team page has none (AC-754). The same door and liveness as
 * the page's facts, so a picture shows only where the page does.
 */
export async function readPagePicture(
  entry: BookingEntry,
  pictures: PublicPictureDeps,
): Promise<AccountPicture | undefined> {
  checkEntry(entry);
  const owner = await inWorkspace(entry.scope, async (tx) => shownPictureOwner(tx, await livePage(tx, entry)));
  return owner === undefined ? undefined : servedPicture(owner, await pictures.pictureOf(owner));
}

/**
 * A handle's profile picture to serve: their account's, when one of Google's (`servedPicture`), else undefined.
 * `crm_handle_owner` answers no picture for a person who keeps it off their public pages (owner ask A124).
 */
export function readProfilePicture(owner: HandleOwner): AccountPicture | undefined {
  return servedPicture(owner.userId, owner.image);
}

/**
 * A link page's contact card as its vCard is written (AC-5113, AC-5114): the card's stored fields checked again, and
 * the person's picture to embed, unless they have none or hid it (the door reads no image then). A card whose stored
 * fields no longer pass the rule is NOT_FOUND, as no card is.
 */
export function readContactCard(found: { readonly owner: HandleOwner; readonly data: unknown }): {
  readonly card: ProfileContactCard;
  readonly handle: string;
  readonly picture?: AccountPicture;
} {
  const data = typeof found.data === 'object' && found.data !== null ? found.data : {};
  const parsed = ProfileContactBlock.safeParse({ ...data, kind: 'contact' });
  if (!parsed.success) throw refuse('NOT_FOUND', 'There’s no contact card here.');
  const { kind: _kind, ...card } = parsed.data;
  const picture = readProfilePicture(found.owner);
  return { card, handle: found.owner.handle, ...(picture === undefined ? {} : { picture }) };
}

/**
 * The page a handle address names (22 Oct 2026), by its public key, and the owner's current handle: the public
 * page then reads it as `/b/<key>` does, closed or not. A deleted page is NOT_FOUND.
 */
export async function readAddressedPage(entry: BookingEntry & { readonly handle: string }): Promise<PublicAddress> {
  checkEntry(entry);
  return inWorkspace(entry.scope, async (tx) => {
    const page = await loadPage(tx, entry.pageId);
    if (page === undefined || page.isDeleted) throw refuse('NOT_FOUND', 'This page is no longer available.');
    return { publicKey: page.publicKey, handle: entry.handle, slug: page.slug };
  });
}

/** A profile's `image`: our own path to the owner's picture, under their current handle, when they have one. */
function withPicture(owner: HandleOwner): { readonly image?: string } {
  const picture = readProfilePicture(owner);
  return picture === undefined ? {} : { image: profilePicturePath(owner.handle, picture.version) };
}

/** Up to two initials of a name, for an avatar without a picture. */
function profileInitials(name: string, handle: string): string {
  return initialsOf(name) || handle.slice(0, 1).toUpperCase();
}

/** What a booking page block shows a visitor: the row the profile drew before blocks (AC-5109). */
interface PageRow {
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly durations: readonly number[];
  readonly isTeam: boolean;
}

/** Whether a block holds the words searched for: its title and its note, or a page's description (AC-5133). */
function matches(item: PublicProfileItem, words: string): boolean {
  // Titles and the short lines under them only (AC-5228). A piece of writing matches on its title alone: a row
  // that matched on words a visitor cannot see in it is a result that makes no sense.
  const said =
    item.kind === 'contact'
      ? [item.fullName, item.jobTitle ?? '', item.company ?? '']
      : item.kind === 'text'
        ? [item.title ?? '']
        : item.kind === 'faq'
          ? [item.title ?? '', ...item.items.map((asked) => asked.question)]
          : [item.title, item.kind === 'link' ? (item.note ?? '') : item.kind === 'page' ? item.description : ''];
  return said.some((text) => text.toLowerCase().includes(words));
}

/** A stored block as a visitor reads it, or undefined: a kind this build doesn't draw, or a page they can't see. */
function publicItemOf(row: LinkPageRow, pages: ReadonlyMap<string, PageRow>): PublicProfileItem | undefined {
  const data: Readonly<Record<string, unknown>> =
    typeof row.data === 'object' && row.data !== null ? (row.data as Readonly<Record<string, unknown>>) : {};
  let candidate: unknown;
  if (row.kind === 'link') {
    const url = typeof data.url === 'string' ? data.url : '';
    // Checked again on the way out: a stored address the rule no longer accepts is never drawn as a link.
    if (!checkProfileLink(url).ok) return undefined;
    // The network's own mark for a profile or site on it, matched here so the public bundle never parses addresses.
    const network = linkMarkOf(url);
    candidate = {
      kind: 'link',
      id: row.id,
      title: data.title,
      url,
      hue: typeof data.hue === 'string' ? data.hue : 'blue',
      ...(typeof data.note === 'string' && data.note !== '' ? { note: data.note } : {}),
      ...(network === undefined ? {} : { mark: network }),
      ...(typeof data.icon === 'string' ? { icon: data.icon } : {}),
    };
  } else if (row.kind === 'heading') {
    candidate = { kind: 'heading', id: row.id, title: data.title };
  } else if (row.kind === 'text') {
    // Checked by its own schema before it goes out, so a row stored by an older build that fails the rule is
    // skipped rather than drawn. The words go as text; nothing here ever becomes markup.
    const written = ProfileTextBlock.safeParse({ ...data, kind: 'text' });
    if (!written.success) return undefined;
    candidate = {
      kind: 'text',
      id: row.id,
      body: written.data.body,
      ...(written.data.title === undefined ? {} : { title: written.data.title }),
    };
  } else if (row.kind === 'faq') {
    // Same rule as a piece of writing: parsed again on the way out, and a row an older build stored badly is
    // skipped rather than half drawn. Every question and answer goes as text.
    const asked = ProfileFaqBlock.safeParse({ ...data, kind: 'faq' });
    if (!asked.success) return undefined;
    candidate = {
      kind: 'faq',
      id: row.id,
      items: asked.data.items,
      ...(asked.data.title === undefined ? {} : { title: asked.data.title }),
    };
  } else if (row.kind === 'page') {
    const page = row.page_id === null ? undefined : pages.get(row.page_id);
    if (page === undefined) return undefined;
    candidate = { kind: 'page', id: row.id, ...page };
  } else if (row.kind === 'contact') {
    // The card's whole rule first, as its vCard reads it, so the page never offers a card that answers 404. Then its
    // name and the line under it only: the email, phone and the rest are in the vCard (AC-5114).
    const card = ProfileContactBlock.safeParse({ ...data, kind: 'contact' });
    if (!card.success) return undefined;
    candidate = {
      kind: 'contact',
      id: row.id,
      fullName: card.data.fullName,
      ...(card.data.jobTitle === undefined ? {} : { jobTitle: card.data.jobTitle }),
      ...(card.data.company === undefined ? {} : { company: card.data.company }),
    };
  } else {
    return undefined;
  }
  const parsed = PublicProfileItem.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}

/**
 * A link page (spec 0051, AC-5108): the person, and one page of their live blocks in order, every kind together
 * (read `PROFILE_PAGE_SIZE + 1` to know there is more). A booking page block shows only while the door lists its page
 * (Public, live, its owner still an active member of a workspace that exists); each workspace's pages are read in one
 * transaction under the first of its entries, every entry checked first, and each page checked again there. A
 * block of a kind this build doesn't draw is skipped. With `search`, every block that matches, flat: no headings and
 * no cursor. The answer names no workspace, no member and no email; the name is the account's, else the handle.
 */
export async function readLinkPage(
  found: {
    readonly owner: HandleOwner;
    readonly rows: readonly LinkPageRow[];
    readonly pages: readonly OwnedPageEntry[];
  },
  query: { readonly search?: string } = {},
): Promise<PublicProfile> {
  for (const entry of found.pages) checkEntry(entry);
  const words = query.search?.trim().toLowerCase().slice(0, 120) ?? '';
  const listed = words === '' ? found.rows.slice(0, PROFILE_PAGE_SIZE) : found.rows;
  const wanted = new Set(listed.flatMap((row) => (row.kind === 'page' && row.page_id !== null ? [row.page_id] : [])));
  const byWorkspace = new Map<string, OwnedPageEntry[]>();
  for (const entry of found.pages) {
    if (!wanted.has(entry.pageId)) continue;
    const group = byWorkspace.get(entry.scope.workspaceId) ?? [];
    group.push(entry);
    byWorkspace.set(entry.scope.workspaceId, group);
  }
  const pages = new Map<string, PageRow>();
  for (const group of byWorkspace.values()) {
    const [first] = group;
    if (first === undefined) continue;
    await inWorkspace(first.scope, async (tx) => {
      const rows = await tx
        .select({
          id: bookingPages.id,
          slug: bookingPages.slug,
          title: bookingPages.title,
          description: bookingPages.description,
          durations: bookingPages.durations,
          kind: bookingPages.kind,
        })
        .from(bookingPages)
        // Listed again under row level security, as the door's definer chose them: a page made Link only, paused or
        // deleted since is left out.
        .where(
          and(
            inArray(
              bookingPages.id,
              group.map((entry) => entry.pageId),
            ),
            isNull(bookingPages.deletedAt),
            eq(bookingPages.isPrivate, false),
            eq(bookingPages.status, 'live'),
          ),
        );
      for (const row of rows) {
        pages.set(row.id, {
          slug: row.slug,
          title: row.title,
          description: row.description,
          durations: row.durations,
          isTeam: row.kind === 'round_robin',
        });
      }
    });
  }
  // A page block whose page sits in another workspace than it names is never shown.
  const where = new Map(found.pages.map((entry) => [entry.pageId, entry.scope.workspaceId]));
  const items = listed.flatMap((row) => {
    if (row.kind === 'page' && (row.page_id === null || where.get(row.page_id) !== row.workspace_id)) return [];
    const item = publicItemOf(row, pages);
    if (item === undefined) return [];
    if (words !== '' && (item.kind === 'heading' || !matches(item, words))) return [];
    return [item];
  });
  const last = listed.at(-1);
  const name = found.owner.name.trim() || found.owner.handle;
  return {
    handle: found.owner.handle,
    name,
    initials: profileInitials(name, found.owner.handle),
    // The account's picture is Google's, which the public pages' policy (img-src 'self') never loads: our own
    // origin serves it, under the current handle.
    ...withPicture(found.owner),
    bio: found.owner.bio,
    // Their social links: the row of icons under the bio, their own set, never a block.
    ...(found.owner.socials.length === 0 ? {} : { socials: [...found.owner.socials] }),
    items,
    ...(words === '' && found.rows.length > PROFILE_PAGE_SIZE && last !== undefined
      ? { next: `${String(last.position)}.${last.id}` }
      : {}),
  };
}

/**
 * Whether the signed in person with this user id hosts the page (spec 0028,
 * AC-720): on their own page they get neither the overlay nor the prefill.
 */
export async function isPageHost(entry: BookingEntry, userId: string): Promise<boolean> {
  checkEntry(entry);
  return inWorkspace(entry.scope, async (tx) => {
    const page = await loadPage(tx, entry.pageId);
    if (page === undefined) return false;
    const team = await loadTeam(tx, page);
    const hosts = [
      ...new Set([page.ownerMemberId, ...(team === undefined ? await membersOf(tx, page) : teamMemberIds(team))]),
    ];
    const found = await tx
      .select({ id: members.id })
      .from(members)
      .where(and(inArray(members.id, hosts), eq(members.userId, userId)))
      .limit(1);
    return found.length > 0;
  });
}

/** Refuses a length the page doesn't offer. */
function checkDuration(page: PageRecord, duration: number): void {
  if (!page.durations.some((offered) => offered === duration)) {
    throw refuseOn('CONFIG_INVALID', 'This page doesn’t offer a meeting of that length.', 'duration');
  }
}

/** The page's slots of one length in the range (AC-629, AC-631), start and end only. */
export async function readPublicSlots(
  entry: BookingEntry,
  deps: PublicBookingDeps,
  query: PublicSlotsQuery,
  /** A verified form hand off (spec 0043, AC-1609): a team page then offers only the times of the hosts it chose. */
  link?: { readonly submissionId: string },
): Promise<PublicSlots> {
  checkEntry(entry);
  const now = deps.now?.() ?? new Date();
  const from = new Date(query.from);
  const to = new Date(query.to);
  const { page, memberIds, team } = await inWorkspace(entry.scope, async (tx) => {
    const live = await livePage(tx, entry);
    checkDuration(live, query.duration);
    const loaded = await loadTeam(tx, live);
    const handed =
      link === undefined || loaded?.kind !== 'round_robin'
        ? undefined
        : await handoffHosts(tx, link.submissionId, live.id);
    const found =
      loaded?.kind === 'round_robin' && handed?.hosts !== undefined ? narrowTeam(loaded, handed.hosts).team : loaded;
    return {
      page: live,
      team: found,
      memberIds: found === undefined ? await membersOf(tx, live) : teamMemberIds(found),
    };
  });
  if (team !== undefined) {
    // A team page: every member's own slots, combined (AC-734 to AC-736). Calendars first, outside the transaction.
    const busyByMember = await memberBusy(
      deps.calendar.busy,
      entry.scope.workspaceId,
      memberIds,
      new Date(from.getTime() - BUSY_MARGIN_MS),
      new Date(to.getTime() + BUSY_MARGIN_MS),
    );
    const reads = await inWorkspace(entry.scope, (tx) =>
      readTeam(tx, page, team, busyByMember, { from, to, margin: BUSY_MARGIN_MS, now }),
    );
    const found = teamSlots(page, team, reads, { duration: query.duration, from, to, now });
    return {
      slots: found.slots.map((slot) => ({ start: slot.start.toISOString(), end: slot.end.toISOString() })),
      calendar: found.blocked ? 'unreachable' : 'ok',
    };
  }
  // Calendars first, outside the database transaction.
  const busy = await membersBusy(
    deps.calendar.busy,
    entry.scope.workspaceId,
    memberIds,
    new Date(from.getTime() - BUSY_MARGIN_MS),
    new Date(to.getTime() + BUSY_MARGIN_MS),
  );
  const margin = { from: new Date(from.getTime() - BUSY_MARGIN_MS), to: new Date(to.getTime() + BUSY_MARGIN_MS) };
  const { booked, closed } = await inWorkspace(entry.scope, async (tx) => ({
    booked: await bookedSpans(tx, memberIds, page.id, from, to),
    closed: await membersClosed(tx, memberIds, page, margin.from, margin.to),
  }));
  const slots = pageSlots(page, { duration: query.duration, from, to, now, busy, bookings: booked, closed });
  return {
    slots: slots.map((slot) => ({ start: slot.start.toISOString(), end: slot.end.toISOString() })),
    calendar: busy.blocked ? 'unreachable' : 'ok',
  };
}

/**
 * What a booking keeps of the visitor's answers: their number, note and guests (milestone 2 adds the questions),
 * and, for a booking made by chat, the conversation (spec 0042, AC-1521).
 */
function answersOf(input: PublicBookInput, chat?: readonly PublicChatLine[]): Readonly<Record<string, unknown>> {
  const guests = [...new Set((input.guests ?? []).filter((guest) => guest !== input.email))];
  return {
    ...(chat === undefined || chat.length === 0 ? {} : { chat: chat.map(({ role, text }) => ({ role, text })) }),
    ...(input.phone === undefined || input.phone === '' ? {} : { phone: input.phone }),
    ...(input.note === undefined || input.note === '' ? {} : { note: input.note }),
    ...(guests.length === 0 ? {} : { guests }),
  };
}

/** The text the calendar event carries: who booked and how to reach them. */
function eventDescription(page: PageRecord, input: PublicBookInput): string {
  return [
    `Booked through “${page.title}”.`,
    `Name: ${input.name}`,
    `Email: ${input.email}`,
    ...(input.phone === undefined || input.phone === '' ? [] : [`Phone: ${input.phone}`]),
    `Time zone: ${input.timeZone}`,
    ...(input.note === undefined || input.note === '' ? [] : ['', input.note]),
  ].join('\n');
}

/** The location line of the event, for anything but video. */
function eventLocation(page: PageRecord, input: PublicBookInput): string | undefined {
  switch (page.location.type) {
    case 'video':
      return undefined;
    case 'phone':
      return input.phone === undefined || input.phone === '' ? undefined : `Phone: ${input.phone}`;
    default:
      return page.location.value;
  }
}

/** A booking, as its visitor sees it. */
interface Booked {
  readonly bookingId: string;
  readonly replayed: boolean;
  readonly booking: PublicBooking;
  /** The guest page's token, derived from the booking's id: a replay answers the same one. */
  readonly manageToken: string;
}

/** The booking this page made under `idempotencyKey`, as its visitor sees it, or undefined. */
async function bookedByKey(
  tx: WorkspaceTx,
  linkKey: ManageLinkKey,
  page: PageRecord,
  idempotencyKey: string,
): Promise<Booked | undefined> {
  const [row] = await tx
    .select()
    .from(bookings)
    .where(and(eq(bookings.pageId, page.id), eq(bookings.idempotencyKey, idempotencyKey)));
  if (row === undefined) return undefined;
  return {
    bookingId: row.id,
    replayed: true,
    manageToken: await ensureManageToken(tx, linkKey, row),
    booking: {
      start: row.startsAt.toISOString(),
      end: row.endsAt.toISOString(),
      title: page.title,
      hostName: await bookingHostName(tx, page, row),
      location: publicLocation(page),
      timeZone: row.visitorTimeZone,
    },
  };
}

/**
 * The booking a retried chat turn already made (spec 0042, AC-1515): the
 * page's booking under the conversation's key, or undefined. Its time is no
 * longer open, so the replay alone can't find it again.
 */
export async function findPublicBooking(
  entry: BookingEntry,
  deps: PublicBookingDeps,
  idempotencyKey: string,
): Promise<Booked | undefined> {
  checkEntry(entry);
  return inWorkspace(entry.scope, async (tx) =>
    bookedByKey(tx, deps.linkKey, await livePage(tx, entry), idempotencyKey),
  );
}

/**
 * A visitor's booking (AC-632 to AC-634): see the header for the steps.
 * `hooks` are the write's (the outbox hook, so the records it makes reach
 * screens live). Refuses SLOT_TAKEN when the slot is gone, BOOKING_CLOSED for
 * a paused page or a host whose calendar can't be read.
 *
 * A team page (spec 0029) reads every member's calendars, and books under the
 * locks of `chooseHost` (round robin: the rotation's, then every member free
 * at the slot) or of every required member (collective), each rechecked
 * against their own hours, bookings on every page and blocks. A collective
 * booking occupies each required member (`booking_hosts`); a round robin one
 * its picked host, with a ledger row saying why.
 */
export async function bookPublicSlot(
  entry: BookingEntry,
  deps: PublicBookingDeps,
  input: PublicBookInput,
  hooks: readonly AfterWrite[] = [],
  /** The form submission a verified hand off named (AC-1058): stored on the booking when it is this workspace's. */
  link?: { readonly submissionId: string },
  /** A booking made by chat keeps the conversation (spec 0042). */
  options: { readonly chat?: readonly PublicChatLine[] } = {},
): Promise<Booked> {
  checkEntry(entry);
  const now = deps.now?.() ?? new Date();
  const start = new Date(input.start);
  const end = new Date(start.getTime() + input.duration * 60_000);
  const workspaceId = entry.scope.workspaceId;

  const replay = (tx: WorkspaceTx, page: PageRecord): Promise<Booked | undefined> =>
    bookedByKey(tx, deps.linkKey, page, input.idempotencyKey);

  // 1. The page, the length, a retry, and who it books.
  type First =
    | { readonly again: Booked }
    | { readonly page: PageRecord; readonly memberIds: readonly string[]; readonly team: Team | undefined };
  const first = await inWorkspace(entry.scope, async (tx): Promise<First> => {
    const page = await loadPage(tx, entry.pageId);
    const again = page === undefined ? undefined : await replay(tx, page);
    if (again !== undefined) return { again };
    const live = liveOf(page);
    checkDuration(live, input.duration);
    if (live.location.type === 'phone' && (input.phone ?? '').trim() === '') {
      throw refuseOn('VALUE_REQUIRED', 'Give a number to call you on.', 'phone');
    }
    const team = await loadTeam(tx, live);
    const memberIds = team === undefined ? await membersOf(tx, live) : teamMemberIds(team);
    if (team === undefined) pickHost(live, memberIds);
    return { page: live, memberIds, team };
  });
  if ('again' in first) return first.again;
  const { page, memberIds, team } = first;
  if (team !== undefined && memberIds.length === 0) throw refuse('SLOT_TAKEN', SLOT_TAKEN_MESSAGE);

  // 2. The calendars, outside any lock: the day around the slot, read fresh.
  const dayFrom = new Date(start.getTime() - 86_400_000);
  const dayTo = new Date(start.getTime() + 86_400_000);
  const busyFrom = new Date(dayFrom.getTime() - BUSY_MARGIN_MS);
  const busyTo = new Date(dayTo.getTime() + BUSY_MARGIN_MS);
  const reader = deps.calendar.busy.fresh ?? deps.calendar.busy;
  const closedMessage = 'This page can’t take bookings right now. Try again later.';
  let busy: MembersBusy = { busy: [], blocked: false, noCalendar: true };
  let teamBusy: ReadonlyMap<string, MembersBusy> = new Map();
  if (team === undefined) {
    busy = await membersBusy(reader, workspaceId, memberIds, busyFrom, busyTo);
    if (busy.blocked) throw refuse('BOOKING_CLOSED', closedMessage);
  } else {
    teamBusy = await memberBusy(reader, workspaceId, memberIds, busyFrom, busyTo);
  }
  const range = { duration: input.duration, from: dayFrom, to: dayTo, now };
  const offeredAt = (slots: readonly { readonly start: Date }[]) =>
    slots.some((slot) => slot.start.getTime() === start.getTime());

  // A team page's slot before any lock: closed when calendars close it (a collective page needs everyone; a round robin
  // page goes on without a member whose calendar refuses us), and a round robin page's candidates per rotation, every
  // one of whom is locked under the write (spec 0037, AC-1321).
  let candidates: readonly (readonly string[])[] = [];
  if (team !== undefined) {
    const offered = await inWorkspace(entry.scope, async (tx) =>
      teamSlots(page, team, await readTeam(tx, page, team, teamBusy, { ...range, margin: BUSY_MARGIN_MS }), range),
    );
    if (offered.blocked) throw refuse('BOOKING_CLOSED', closedMessage);
    const slot = offered.slots.find((each) => each.start.getTime() === start.getTime());
    if (slot === undefined) throw refuse('SLOT_TAKEN', SLOT_TAKEN_MESSAGE);
    candidates = slot.candidates;
  }

  // Routing (spec 0043): a hand off's hosts, else the page's rules over the guest's record fields, read here before
  // any lock, so a busy team page's bookings never wait on them.
  const routing: BookingRouting | undefined =
    team?.kind === 'round_robin'
      ? await inWorkspace(entry.scope, (tx) =>
          routeBooking(tx, {
            page,
            objects: { people: entry.people, companies: entry.companies },
            email: input.email,
            ...(link === undefined ? {} : { submissionId: link.submissionId }),
          }),
        )
      : undefined;

  // 3. Check and reserve, atomically, under the locks. The id is made here, so the token derives from it.
  const newId = randomUUID();
  const { token, hash: tokenHash } = manageTokenFor(deps.linkKey, newId);
  const { result } = await runWrite(
    entry.scope,
    async (context) => {
      const { tx } = context;
      let host: string;
      let hosts: readonly string[];
      let chosen: ChosenHosts | undefined;
      let narrowed = false;
      if (team?.kind === 'round_robin') {
        // The rotations' locks first, so a retry finds its booking before anything else waits.
        await lockRotations(
          tx,
          workspaceId,
          team.rotations.map((rotation) => rotation.rules.id),
        );
        const again = await replay(tx, page);
        if (again !== undefined) return again;
        const choice = {
          workspaceId,
          start,
          duration: input.duration,
          candidates,
          busy: teamBusy,
          from: dayFrom,
          to: dayTo,
          now,
          guest: { email: input.email, peopleObjectId: entry.people },
        };
        // Routing (spec 0043, AC-1609, AC-1610), decided before the locks: its hosts are picked first when free.
        chosen = await chooseHosts(tx, page, team, {
          ...choice,
          ...(routing?.hosts === undefined ? {} : { prefer: allowFor(team, routing.hosts) }),
        });
        narrowed = chosen.narrowed;
        host = chosen.organiser;
        hosts = chosen.hosts;
      } else if (team?.kind === 'collective') {
        await lockHosts(tx, workspaceId, memberIds);
        const again = await replay(tx, page);
        if (again !== undefined) return again;
        const reads = await readTeam(tx, page, team, teamBusy, { ...range, margin: BUSY_MARGIN_MS });
        if (!offeredAt(teamSlots(page, team, reads, range).slots)) throw refuse('SLOT_TAKEN', SLOT_TAKEN_MESSAGE);
        host = pickHost(page, memberIds);
        hosts = memberIds;
      } else {
        await lockHosts(tx, workspaceId, memberIds);
        const again = await replay(tx, page);
        if (again !== undefined) return again;
        const held = await bookedSpans(tx, memberIds, page.id, dayFrom, dayTo);
        const closed = await membersClosed(tx, memberIds, page, busyFrom, busyTo);
        if (!offeredAt(pageSlots(page, { ...range, busy, bookings: held, closed }))) {
          throw refuse('SLOT_TAKEN', SLOT_TAKEN_MESSAGE);
        }
        host = pickHost(page, memberIds);
        hosts = [host];
      }
      const blockStart = new Date(start.getTime() - page.bufferBefore * 60_000);
      const blockEnd = new Date(end.getTime() + page.bufferAfter * 60_000);
      const during = sql`tstzrange(${blockStart.toISOString()}::timestamptz, ${blockEnd.toISOString()}::timestamptz, '[)')`;
      const actor = { type: 'booking' as const, id: page.id, memberId: null };
      let bookingId: string;
      try {
        // A hand off names a submission; it is linked only when it is this workspace's and its form sends its
        // visitors on to this very page.
        const submissionId = link === undefined ? undefined : await handoffSubmission(tx, link.submissionId, page.id);
        const [row] = await tx
          .insert(bookings)
          .values({
            workspaceId,
            id: newId,
            pageId: page.id,
            hostMemberId: host,
            startsAt: start,
            endsAt: end,
            during,
            visitorName: input.name,
            visitorEmail: input.email,
            visitorTimeZone: input.timeZone,
            answers: answersOf(input, options.chat),
            ...(submissionId === undefined ? {} : { submissionId }),
            manageTokenHash: tokenHash,
            manageTokenDerived: true,
            idempotencyKey: input.idempotencyKey,
            createdByType: actor.type,
            createdById: actor.id,
            createdByMemberId: actor.memberId,
            updatedByType: actor.type,
            updatedById: actor.id,
            updatedByMemberId: actor.memberId,
          })
          .returning({ id: bookings.id });
        if (row === undefined) throw new Error('The booking was not stored.');
        bookingId = row.id;
        if (routing !== undefined) {
          await recordBookingRouting(tx, { workspaceId, pageId: page.id, bookingId, routing, narrowed });
        }
        // The organiser's own `booking_hosts` row comes with the booking (its trigger); every other host's here.
        const others = hosts.filter((memberId) => memberId !== host);
        if (others.length > 0) {
          await tx
            .insert(bookingHosts)
            .values(others.map((memberId) => ({ workspaceId, bookingId, memberId, during, status: 'confirmed' })));
        }
        // The reminders with the booking; the confirmation after its event, so it knows whether the calendar invited them.
        await enqueueBookingMail(tx, bookingId, ['reminder_24h', 'reminder_1h']);
      } catch (error) {
        // The locks should make this unreachable: a write that skipped them, refused by the database.
        if (postgresError(error)?.code === '23P01') throw refuse('SLOT_TAKEN', SLOT_TAKEN_MESSAGE);
        throw error;
      }
      // One ledger row per rotation, saying why (AC-742, AC-1321).
      if (chosen !== undefined && team?.kind === 'round_robin') {
        for (const pick of chosen.picks) {
          const rules = team.rotations.find((rotation) => rotation.rules.id === pick.rotationId)?.rules;
          await writeAssignment(tx, entry.scope, {
            rotationId: pick.rotationId,
            memberId: pick.memberId,
            source: 'booking',
            bookingId,
            reason: pick.reason,
            detail: { ...pick.detail, windowDays: rules?.windowDays ?? 30 },
          });
        }
      }
      // The visitor's records, under a lock on their email, in a savepoint: a refusal keeps the booking. On a round
      // robin page, a person or company made now is the assigned host's (AC-744); one that exists keeps its owner.
      await lockKey(tx, `booking:email:${workspaceId}:${input.email}`);
      const matched = await context.perRecord((step) =>
        matchVisitor(
          step,
          { people: entry.people, companies: entry.companies },
          {
            name: input.name,
            email: input.email,
            timeZone: input.timeZone,
            // The first rotation's pick: the member the round robin assigned it to.
            ...(chosen?.picks[0] === undefined ? {} : { ownerMemberId: chosen.picks[0].memberId }),
          },
        ),
      );
      if (matched.ok && (matched.value.personId !== undefined || matched.value.companyId !== undefined)) {
        await tx
          .update(bookings)
          .set({ personRecordId: matched.value.personId ?? null, companyRecordId: matched.value.companyId ?? null })
          .where(eq(bookings.id, bookingId));
      }
      return {
        bookingId,
        replayed: false,
        manageToken: token,
        hostMemberId: host,
        hosts,
        booking: {
          start: start.toISOString(),
          end: end.toISOString(),
          title: page.title,
          hostName: chosen === undefined ? await hostName(tx, host) : await hostNames(tx, hosts),
          location: publicLocation(page),
          timeZone: input.timeZone,
        },
      } satisfies Booked & { readonly hostMemberId: string; readonly hosts: readonly string[] };
    },
    hooks,
  );
  if (result.replayed) return result;
  const {
    hostMemberId: host,
    hosts,
    ...booked
  } = result as Booked & { readonly hostMemberId: string; readonly hosts: readonly string[] };

  // 4. The calendar event on the host's calendar, after the commit: three tries, then the booking stands without one.
  // A team booking's other hosts are invited beside the visitor (AC-627, AC-1322).
  const coHosts = await memberEmails(
    entry,
    hosts.filter((id) => id !== host),
  );
  let written: Awaited<ReturnType<BookingCalendar['events']>> | undefined;
  for (let attempt = 1; attempt <= 3 && written === undefined; attempt += 1) {
    try {
      written = await deps.calendar.events({
        workspaceId,
        hostMemberId: host,
        bookingId: booked.bookingId,
        pageId: entry.pageId,
        title: `${page.title} with ${input.name}`,
        description: eventDescription(page, input),
        start: start.toISOString(),
        end: end.toISOString(),
        attendees: [
          { email: input.email, name: input.name },
          ...(input.guests ?? [])
            .filter((guest) => guest !== input.email)
            .map((guest) => ({ email: guest, name: guest })),
          ...coHosts,
        ],
        video: page.location.type === 'video',
        ...(eventLocation(page, input) === undefined ? {} : { location: eventLocation(page, input) }),
      });
    } catch (error) {
      deps.log?.warn('booking.event_failed', {
        bookingId: booked.bookingId,
        attempt,
        error: error instanceof Error ? error.name : 'unknown',
      });
    }
  }
  // The outcome, and the emails (after the event, so the confirmation knows whether the calendar already invited them).
  await inWorkspace(entry.scope, async (tx) => {
    await recordEvent(tx, booked.bookingId, written);
    await enqueueBookingMail(tx, booked.bookingId, ['confirmed']);
  });
  return booked;
}

/** Members' names and emails, for a collective event's attendees (the calendar invites them; no visitor sees them). */
async function memberEmails(
  entry: BookingEntry,
  memberIds: readonly string[],
): Promise<readonly { readonly email: string; readonly name: string }[]> {
  if (memberIds.length === 0) return [];
  return inWorkspace(entry.scope, (tx) =>
    tx
      .select({ email: members.email, name: members.name })
      .from(members)
      .where(inArray(members.id, [...memberIds])),
  );
}

/** The answers a booking keeps, read back as the guest page shows them. */
function storedAnswers(answers: unknown): { readonly note?: string; readonly guests: readonly string[] } {
  if (typeof answers !== 'object' || answers === null) return { guests: [] };
  const note = 'note' in answers && typeof answers.note === 'string' ? answers.note : undefined;
  const guests =
    'guests' in answers && Array.isArray(answers.guests)
      ? answers.guests.filter((guest): guest is string => typeof guest === 'string')
      : [];
  return { ...(note === undefined ? {} : { note }), guests };
}

/**
 * The name and email a form's hand off names (spec 0023 AC-1058), for the
 * booking page's prefill: read from the stored submission in this page's
 * workspace, never from the link. Empty for a submission that isn't there.
 */
export async function readHandoffPrefill(
  entry: BookingEntry,
  submissionId: string,
): Promise<{ readonly name?: string; readonly email?: string }> {
  checkEntry(entry);
  return inWorkspace(entry.scope, (tx) => handoffVisitor(tx, submissionId, entry.pageId));
}

/** A daily visitor id (spec 0047, AC-1626): 32 lowercase hex digits, an HMAC the api made; never an address. */
const VISITOR_ID = /^[0-9a-f]{32}$/;

/**
 * Counts one view of the page (spec 0047, AC-1625): today's row for this
 * visitor (UTC), made or bumped. The caller decides it counts (not a host,
 * not the editor's preview). Only the count: nothing about the visitor but
 * the daily id is kept.
 */
export async function countPageView(entry: BookingEntry, visitor: string): Promise<void> {
  checkEntry(entry);
  if (!VISITOR_ID.test(visitor)) throw new TypeError('A visitor is 32 lowercase hex digits.');
  await inWorkspace(entry.scope, (tx) =>
    tx.execute(sql`
      insert into booking_page_views (workspace_id, page_id, day, visitor)
      values (${entry.scope.workspaceId}, ${entry.pageId}, (now() at time zone 'UTC')::date, ${visitor})
      on conflict (workspace_id, page_id, day, visitor)
        do update set views = booking_page_views.views + 1, last_at = now()
    `),
  );
}

/**
 * The booking a manage token opens, as its guest sees it (AC-674): its state
 * (confirmed, cancelled, or past once it ended), the time, the page's facts,
 * the visitor, guests and note. A deleted page still shows its bookings.
 */
export async function readManagedBooking(
  entry: BookingEntry & { readonly bookingId: string },
  now: Date = new Date(),
): Promise<PublicManagedBooking> {
  checkEntry(entry);
  return inWorkspace(entry.scope, async (tx) => {
    const [row] = await tx.select().from(bookings).where(eq(bookings.id, entry.bookingId));
    const page = await loadPage(tx, entry.pageId);
    if (row === undefined || page === undefined) throw refuse('NOT_FOUND', 'This link doesn’t open a booking.');
    const answers = storedAnswers(row.answers);
    const canChange = row.status === 'confirmed' && row.startsAt.getTime() > now.getTime();
    const [workspace] = await tx.select({ slug: workspaces.slug }).from(workspaces).limit(1);
    return {
      workspaceSlug: workspace?.slug ?? '',
      canChange,
      canMove: canChange && !page.isDeleted && page.status === 'live' && row.reschedules < MAX_RESCHEDULES,
      ...(row.cancelReason === null ? {} : { cancelReason: row.cancelReason }),
      state: row.status === 'cancelled' ? 'cancelled' : row.endsAt.getTime() <= now.getTime() ? 'past' : 'confirmed',
      publicKey: page.publicKey,
      title: page.title,
      hostName: await bookingHostName(tx, page, row),
      start: row.startsAt.toISOString(),
      end: row.endsAt.toISOString(),
      timeZone: row.visitorTimeZone,
      location: publicLocation(page),
      ...(row.videoUrl === null ? {} : { videoUrl: row.videoUrl }),
      visitorName: row.visitorName,
      visitorEmail: row.visitorEmail,
      guests: [...answers.guests],
      ...(answers.note === undefined ? {} : { note: answers.note }),
    };
  });
}

/** Where the calendar entry is sent from, and the app it points back to. */
export interface IcsOrigin {
  /** The app's origin (`https://app.example`): the UID's domain, and the guest page's while `publicOrigin` is unset. */
  readonly appOrigin: string;
  /** Where the public booking pages are served (`BOOKING_PUBLIC_ORIGIN`), when not on the app's origin. */
  readonly publicOrigin?: string;
  readonly organizerEmail: string;
  readonly organizerName: string;
}

/** The booking a manage token opens, as an `.ics` file for Add to calendar (AC-674). */
export async function managedBookingIcs(
  entry: BookingEntry & { readonly bookingId: string },
  token: string,
  origin: IcsOrigin,
  now: Date = new Date(),
): Promise<string> {
  const booking = await readManagedBooking(entry, now);
  const where =
    booking.videoUrl ??
    (booking.location.type === 'address' || booking.location.type === 'custom' ? booking.location.value : undefined);
  return buildBookingIcs({
    bookingId: entry.bookingId,
    uidDomain: new URL(origin.appOrigin).host,
    method: booking.state === 'cancelled' ? 'CANCEL' : 'REQUEST',
    start: new Date(booking.start),
    end: new Date(booking.end),
    summary: `${booking.title} with ${booking.hostName}`,
    description: booking.note ?? '',
    ...(where === undefined ? {} : { location: where }),
    url: `${origin.publicOrigin ?? origin.appOrigin}${managePath(booking.publicKey, token)}`,
    organizerEmail: origin.organizerEmail,
    organizerName: origin.organizerName,
    attendees: [{ name: booking.visitorName, email: booking.visitorEmail }],
    // Grows with each download, so a calendar holding an earlier copy takes this one (a move's new time).
    sequence: Math.floor(now.getTime() / 1000),
    now,
  });
}
