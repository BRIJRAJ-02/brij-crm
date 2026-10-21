// The visitor's two remembered choices on this browser (spec 0025, AC-666,
// AC-668): Month, List or Chat (spec 0041), and 12 or 24 hours. Storage can be missing or
// throw (a private window, blocked site data), so every read and write is
// guarded and the page works the same without it.

const VIEW_KEY = 'crm.booking.view';
const CLOCK_KEY = 'crm.booking.clock';

/** Month, List, or Book by chat (spec 0041). */
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

/** The remembered view, Month by default. */
export function savedView(): SlotView {
  const view = read(VIEW_KEY);
  return view === 'list' || view === 'chat' ? view : 'month';
}
/** Remembers the view. */
export const saveView = (view: SlotView) => write(VIEW_KEY, view);
/** The remembered clock, or undefined for the locale's. */
export function savedHour12(): boolean | undefined {
  const value = read(CLOCK_KEY);
  return value === '12' ? true : value === '24' ? false : undefined;
}
/** Remembers the clock. */
export const saveHour12 = (hour12: boolean) => write(CLOCK_KEY, hour12 ? '12' : '24');
