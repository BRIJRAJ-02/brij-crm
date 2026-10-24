// The visitor's two remembered choices on this browser (spec 0025, AC-666,
// AC-668): Month, List or Chat (spec 0042), and 12 or 24 hours. Storage can be missing or
// throw (a private window, blocked site data), so every read and write is
// guarded and the page works the same without it.
//
// A third thing is kept here, not a choice but a hint (25 Oct 2026): the view each page last opened in, under its
// address. A page's own default comes with its facts, which the shape drawn while they are still coming can't wait
// for, so that shape follows the hint and holds the place the page will take.

const VIEW_KEY = 'crm.booking.view';
const CLOCK_KEY = 'crm.booking.clock';
const OPENS_KEY = 'crm.booking.opens';

/** How many pages' opening views this browser keeps: a visitor meets a handful, and the newest pushes out the oldest. */
const OPENS_MAX = 8;

/** Month, List, or Book by chat (spec 0042). */
export type SlotView = 'month' | 'list' | 'chat';

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

/**
 * The view this browser last chose, or undefined when it has chosen none. The page's own default (the host's
 * setting, 25 Oct 2026) fills that gap, so a remembered choice always wins over the host's default.
 */
export function savedView(): SlotView | undefined {
  const view = read(VIEW_KEY);
  return view === 'month' || view === 'list' || view === 'chat' ? view : undefined;
}
/** Remembers the view. */
export const saveView = (view: SlotView) => write(VIEW_KEY, view);

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

/** The views pages at these addresses opened in, newest first; anything damaged reads as none. */
function opened(): Readonly<Record<string, SlotView>> {
  const stored = read(OPENS_KEY);
  if (stored === undefined) return {};
  try {
    const parsed: unknown = JSON.parse(stored);
    if (typeof parsed !== 'object' || parsed === null) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (entry): entry is [string, SlotView] => entry[1] === 'month' || entry[1] === 'list' || entry[1] === 'chat',
      ),
    );
  } catch {
    return {};
  }
}

/**
 * The view the page at this address opened in last time (the host's default as it was then), so the shape drawn
 * while the facts are still coming holds the same place as the page that arrives. Only a hint: the facts decide.
 */
export function openedBefore(path: string): SlotView | undefined {
  const kept = opened();
  const key = keyOf(path);
  return Object.hasOwn(kept, key) ? kept[key] : undefined;
}

/** Keeps the view a page opened in, under its address, newest first, so a page met often is never pushed out. */
export function rememberOpened(path: string, view: SlotView): void {
  const kept = opened();
  const key = keyOf(path);
  const entries: [string, SlotView][] = [[key, view], ...Object.entries(kept).filter(([each]) => each !== key)];
  write(OPENS_KEY, JSON.stringify(Object.fromEntries(entries.slice(0, OPENS_MAX))));
}
/** The remembered clock, or undefined for the locale's. */
export function savedHour12(): boolean | undefined {
  const value = read(CLOCK_KEY);
  return value === '12' ? true : value === '24' ? false : undefined;
}
/** Remembers the clock. */
export const saveHour12 = (hour12: boolean) => write(CLOCK_KEY, hour12 ? '12' : '24');
