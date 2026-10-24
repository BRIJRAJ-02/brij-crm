// What this browser remembers for a booking page (spec 0025, AC-666, AC-668): which way to see times, Month, List
// or Chat (spec 0042), and 12 or 24 hours. Storage can be missing or throw (a private window, blocked site data),
// so every read and write is guarded and the page works the same without it.
//
// The view is remembered per page, under its address (26 Oct 2026). It used to be one choice for every booking
// page, which left a visitor who had ever touched the switch anywhere never seeing any host's default again. Note
// too that `savedView` now answers undefined where nothing is remembered, where it used to answer Month: Month is
// no longer this module's to decide, since a page carries the view its host set it to open in.
//
// One store holds it, `crm.booking.opens`, newest page first and capped, each entry keyed by a hash of the address
// so what is kept is never a readable list of the pages this browser opened. An entry holds two things: the view
// chosen on that page, if one was, and the view it last opened in, which is the shape the page draws while its
// facts are still coming (they carry the host's default, and nothing drawn before them can wait for it). An entry
// pushed out by newer pages leaves the page opening in its host's default again, which is the right answer.
//
// The clock stays one choice for every page: an hour is read the same way wherever it is written.

const CLOCK_KEY = 'crm.booking.clock';
const OPENS_KEY = 'crm.booking.opens';

/** How many pages this browser remembers: a visitor meets a handful, and the newest pushes out the oldest. */
const OPENS_MAX = 8;

/** Month, List, or Book by chat (spec 0042). */
export type SlotView = 'month' | 'list' | 'chat';

/** What one page is remembered by: the view chosen on it, and the view it last opened in. */
interface Remembered {
  readonly chose?: SlotView;
  readonly opened?: SlotView;
}

function read(key: string): string | undefined {
  try {
    return globalThis.localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

function write(key: string, value: string): void {
  try {
    globalThis.localStorage.setItem(key, value);
  } catch {
    // Not remembered; nothing else changes.
  }
}

/** A view, from anything: the public facts are read without a schema, so an older API may answer none. */
export function viewOf(value: unknown): SlotView | undefined {
  return value === 'month' || value === 'list' || value === 'chat' ? value : undefined;
}

/**
 * An address as a short key (FNV-1a), so what is kept is never a readable list of the pages this browser opened: a
 * link only page's address is its whole secret. Two addresses sharing a key only draw one loading shape wrongly.
 */
function keyOf(path: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < path.length; index += 1) {
    hash ^= path.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}

/** One stored entry, with anything damaged or unknown dropped; an entry left with nothing reads as none. */
function entryOf(value: unknown): Remembered | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const held = value as Record<string, unknown>;
  const chose = viewOf(held.chose);
  const opened = viewOf(held.opened);
  if (chose === undefined && opened === undefined) return undefined;
  return { ...(chose === undefined ? {} : { chose }), ...(opened === undefined ? {} : { opened }) };
}

/** What each page is remembered by, newest first; anything damaged reads as none. */
function remembered(): Readonly<Record<string, Remembered>> {
  const stored = read(OPENS_KEY);
  if (stored === undefined) return {};
  try {
    const parsed: unknown = JSON.parse(stored);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const entries = Object.entries(parsed as Record<string, unknown>)
      .map(([key, value]) => [key, entryOf(value)] as const)
      .filter((entry): entry is readonly [string, Remembered] => entry[1] !== undefined);
    return Object.fromEntries(entries);
  } catch {
    return {};
  }
}

/** One page's entry, or undefined for a page this browser doesn't hold. */
function entryFor(path: string): Remembered | undefined {
  const kept = remembered();
  const key = keyOf(path);
  return Object.hasOwn(kept, key) ? kept[key] : undefined;
}

/** Keeps one page's entry, newest first, so a page met often is never pushed out by a page met once. */
function keep(path: string, entry: Remembered): void {
  const kept = remembered();
  const key = keyOf(path);
  const entries: [string, Remembered][] = [[key, entry], ...Object.entries(kept).filter(([each]) => each !== key)];
  write(OPENS_KEY, JSON.stringify(Object.fromEntries(entries.slice(0, OPENS_MAX))));
}

/**
 * The view chosen on the page at this address, or undefined where none was. The page's own default (the view its
 * host set it to open in) fills that gap, so a choice made on a page always wins over its host's default, and a
 * choice made on another page never reaches this one.
 */
export const savedView = (path: string): SlotView | undefined => entryFor(path)?.chose;

/** Remembers the view chosen on the page at this address. */
export function saveView(path: string, view: SlotView): void {
  keep(path, { ...entryFor(path), chose: view });
}

/**
 * The view the page at this address opened in last time, which is the choice made on it, else the host's default as
 * it was then. The shape drawn while the facts are still coming holds that view's place, so the page fills in
 * rather than moving. Only a hint: the facts, and a choice on this page, decide.
 */
export const openedBefore = (path: string): SlotView | undefined => {
  const entry = entryFor(path);
  return entry?.chose ?? entry?.opened;
};

/** Keeps the view the page at this address opened in, and moves it to the front, since it was just met. */
export function rememberOpened(path: string, view: SlotView): void {
  keep(path, { ...entryFor(path), opened: view });
}

/** The remembered clock, or undefined for the locale's. */
export function savedHour12(): boolean | undefined {
  const value = read(CLOCK_KEY);
  return value === '12' ? true : value === '24' ? false : undefined;
}
/** Remembers the clock. */
export const saveHour12 = (hour12: boolean) => write(CLOCK_KEY, hour12 ? '12' : '24');
