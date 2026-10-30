// The calendar's single keys, as Google Calendar's: T today, J the next week (or day), K the one before, D the day
// view, W the week view. Plain, so which press means what is tested in Node; the screen decides whether a press is
// its own (not typed into a field, not inside a dialog).

/** What a key does on Bookings' calendar. */
export type WeekKeyAction = 'today' | 'next' | 'previous' | 'day' | 'week';

/** A key press, as much of it as the choice needs. */
export interface WeekKeyPress {
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly repeat?: boolean;
}

const ACTIONS: Readonly<Record<string, WeekKeyAction>> = {
  t: 'today',
  j: 'next',
  k: 'previous',
  d: 'day',
  w: 'week',
};

/** The keycaps each action shows in its tooltip. */
export const WEEK_KEYS: Readonly<Record<WeekKeyAction, string>> = {
  today: 'T',
  next: 'J',
  previous: 'K',
  day: 'D',
  week: 'W',
};

/** The action a press means, or undefined: a bare letter only (Shift allowed for caps lock), never held down. */
export function weekKeyAction(press: WeekKeyPress): WeekKeyAction | undefined {
  if (press.metaKey || press.ctrlKey || press.altKey || press.repeat === true) return undefined;
  return ACTIONS[press.key.toLowerCase()];
}
