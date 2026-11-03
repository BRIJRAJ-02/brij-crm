// A page's unpublished changes (spec 0068, AC-6810, AC-6811), as pure functions: the draft read off a stored row, the
// settings guests see now, what a draft changes against them, and each change in a plain sentence. No I/O, so the
// services in `publish.ts` and the views in `pages.ts` share one reading of a draft, and the tests run in Node.
import {
  BOOKING_DRAFT_KEYS,
  BookingPageDraft,
  type BookingDraftKey,
  type BookingLocation,
  type BookingPageSettings,
} from '@crm/contracts';

/** The kinds of page that draft (link, business and event pages arrive on the same pattern). */
export type DraftedPageKind = 'booking' | 'link';

/** A stored draft as the services read it: checked by the shared schema, anything that doesn't parse read as none. */
export function draftOf(stored: unknown, pageId?: string): BookingPageDraft {
  if (stored === null || stored === undefined) return {};
  const parsed = BookingPageDraft.safeParse(stored);
  if (parsed.success) return parsed.data;
  // Read as none, so the page still opens, but said: a draft an older build wrote badly would otherwise vanish
  // without a trace. Only where it broke, never the values.
  console.warn('booking page draft unreadable', {
    code: 'DRAFT_UNREADABLE',
    ...(pageId === undefined ? {} : { pageId }),
    paths: parsed.error.issues.map((issue) => issue.path.join('.')),
  });
  return {};
}

/** What guests see of a booking page: its drafted settings as they are published. */
export type PublishedBooking = Pick<BookingPageSettings, BookingDraftKey>;

/** The published settings of a page, whole: what a version keeps (the migration's version 1 writes the same keys). */
export function publishedSnapshot(page: PublishedBooking): PublishedBooking {
  return Object.fromEntries(BOOKING_DRAFT_KEYS.map((key) => [key, page[key]])) as unknown as PublishedBooking;
}

/** Whether two settings' values are the same: compared as their JSON, so arrays and objects compare by content. */
function same(one: unknown, other: unknown): boolean {
  return JSON.stringify(one ?? null) === JSON.stringify(other ?? null);
}

/** The draft with every setting that is back to what guests see left out: an empty draft has nothing to publish. */
export function changedOnly(draft: BookingPageDraft, published: PublishedBooking): BookingPageDraft {
  return Object.fromEntries(
    Object.entries(draft).filter(([key, value]) => !same(value, published[key as BookingDraftKey])),
  );
}

/** A draft taken over the published page: what the editor shows and what Publish writes. */
export function withDraft<Page extends PublishedBooking>(page: Page, draft: BookingPageDraft): Page {
  return { ...page, ...draft };
}

/** A version's settings as a draft against what guests see now: the settings that differ (AC-6812's restore). */
export function draftFromSnapshot(snapshot: unknown, published: PublishedBooking): BookingPageDraft {
  const parsed = BookingPageDraft.safeParse(snapshot);
  return parsed.success ? changedOnly(parsed.data, published) : {};
}

/** Minutes as people say them: "45 min", "2 h", "1 h 30 min". */
function minutes(value: number): string {
  if (value < 60) return `${String(value)} min`;
  const hours = Math.floor(value / 60);
  const rest = value % 60;
  return rest === 0 ? `${String(hours)} h` : `${String(hours)} h ${String(rest)} min`;
}

/** A cancel or move cutoff as people say it: "none", "2 h", "3 days". */
function cutoff(value: number): string {
  if (value === 0) return 'none';
  const days = value / (24 * 60);
  if (Number.isInteger(days)) return days === 1 ? '1 day' : `${String(days)} days`;
  return minutes(value);
}

/** What a page does once a booking commits, as the editor names it. */
function afterWords(value: unknown): string {
  return value === 'redirect' ? 'Redirect' : 'Confirmation page';
}

/** A location's kind, as the editor names it. */
function place(location: BookingLocation | undefined): string {
  switch (location?.type) {
    case 'video':
      return 'Video call';
    case 'phone':
      return 'Phone';
    case 'address':
      return 'In person';
    case 'custom':
      return 'Custom';
    default:
      return 'None';
  }
}

/** A short quoted value, cut at 40 characters, so a sentence never carries a whole description. */
function quoted(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > 40 ? `“${trimmed.slice(0, 39)}…”` : `“${trimmed}”`;
}

/** One booking page setting's change as a sentence, or undefined when it says nothing new. */
function bookingSentence(key: BookingDraftKey, before: unknown, after: unknown): string {
  switch (key) {
    case 'title':
      return `Title ${quoted(String(before))} → ${quoted(String(after))}`;
    case 'description':
      return String(after).trim() === '' ? 'Description removed' : 'Description changed';
    case 'durations': {
      const list = (value: unknown) =>
        Array.isArray(value) ? value.map((one) => minutes(Number(one))).join(', ') : '';
      return `Length ${list(before)} → ${list(after)}`;
    }
    case 'location':
      return place(before as BookingLocation) === place(after as BookingLocation)
        ? 'Location changed'
        : `Location ${place(before as BookingLocation)} → ${place(after as BookingLocation)}`;
    case 'bufferBefore':
      return `Buffer before ${minutes(Number(before))} → ${minutes(Number(after))}`;
    case 'bufferAfter':
      return `Buffer after ${minutes(Number(before))} → ${minutes(Number(after))}`;
    case 'minNoticeMinutes':
      return `Notice ${minutes(Number(before))} → ${minutes(Number(after))}`;
    case 'windowDays':
      return `Books ${String(before)} → ${String(after)} days ahead`;
    case 'dailyLimit':
      return after === null
        ? 'Daily limit removed'
        : before === null
          ? `Daily limit set to ${String(Number(after))}`
          : `Daily limit ${String(Number(before))} → ${String(Number(after))}`;
    case 'slotStep':
      return after === null ? 'Start times follow the length' : `Start times every ${minutes(Number(after))}`;
    case 'scheduleId':
      return 'Hours changed';
    case 'defaultView':
      return `First view ${String(before)} → ${String(after)}`;
    case 'showSocials':
      return after === true ? 'Social links shown' : 'Social links hidden';
    case 'questions': {
      const count = (value: unknown) => (Array.isArray(value) ? value.length : 0);
      return count(before) === count(after)
        ? 'Questions changed'
        : `Questions ${String(count(before))} → ${String(count(after))}`;
    }
    case 'requiresConfirmation':
      return after === true ? 'Bookings wait for your confirmation' : 'Bookings confirm at once';
    case 'afterBooking':
      return `After booking ${afterWords(before)} → ${afterWords(after)}`;
    case 'redirectUrl':
      return after === null ? 'Redirect address removed' : 'Redirect address changed';
    case 'sendBookingDetails':
      return after === true ? 'Redirect sends the booking’s details' : 'Redirect sends no details';
    case 'cancelCutoffMinutes':
      return `Cancel cutoff ${cutoff(Number(before))} → ${cutoff(Number(after))}`;
    case 'moveCutoffMinutes':
      return `Move cutoff ${cutoff(Number(before))} → ${cutoff(Number(after))}`;
    case 'linksOnly':
      return after === true ? 'Books only through one-time links' : 'Books from its own address again';
  }
}

/** A link page's look keys as the Changes list names them (`template`, `avatar`). */
const LINK_WORDS: Readonly<Record<string, string>> = {
  classic: 'Classic',
  studio: 'Studio',
  night: 'Night',
  split: 'Split',
  circle: 'Circle',
  rounded: 'Rounded',
};

/**
 * Each change a draft makes, as a plain sentence (AC-6811): "Length 30 min → 45 min", "Template Classic → Studio".
 * A setting the draft holds at its published value says nothing. Booking settings come in the editor's order.
 */
export function diffPage(kind: DraftedPageKind, publishedPage: object, draftPage: object): readonly string[] {
  const published = publishedPage as Readonly<Record<string, unknown>>;
  const draft = draftPage as Readonly<Record<string, unknown>>;
  const changed = Object.keys(draft).filter((key) => !same(draft[key], published[key]));
  if (kind === 'link') {
    return changed.flatMap((key) => {
      const name = key === 'template' ? 'Template' : key === 'avatar' ? 'Face' : undefined;
      if (name === undefined) return [];
      const word = (value: unknown) => LINK_WORDS[String(value)] ?? 'Workspace’s';
      return [`${name} ${word(published[key])} → ${word(draft[key])}`];
    });
  }
  const order = new Map<string, number>(BOOKING_DRAFT_KEYS.map((key, index) => [key, index]));
  return changed
    .filter((key): key is BookingDraftKey => order.has(key))
    .sort((one, other) => (order.get(one) ?? 0) - (order.get(other) ?? 0))
    .map((key) => bookingSentence(key, published[key], draft[key]));
}
