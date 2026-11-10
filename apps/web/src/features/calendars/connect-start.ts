// Which account a connect just made. The provider's consent screen is a whole page away and the API sends the browser
// back with only how it went (`?calendar=connected`), so before it leaves, the page notes the accounts it already had
// (and the one it is reconnecting, if any). Back on the page, the one account not in that note is the new one: its
// row washes in and the connect popup asks which of its calendars block your times. The note lives in this tab's
// session storage, for ten minutes, and is read once; without it (another tab, storage off) nothing is guessed.

/** What the page noted before it went to the provider. */
export interface ConnectStart {
  /** The member's connections before the connect. */
  readonly before: readonly string[];
  /** The connection being reconnected, when it was a Reconnect. */
  readonly reconnecting?: string;
}

/** What came back: a new account, a reconnected one, or nothing known. */
export type ConnectArrival =
  | { readonly kind: 'new'; readonly connectionId: string }
  | { readonly kind: 'reconnected'; readonly connectionId: string }
  | { readonly kind: 'unknown' };

/** The minimal storage the note needs, so tests can pass their own. */
export interface NoteStore {
  readonly getItem: (key: string) => string | null;
  readonly setItem: (key: string, value: string) => void;
  readonly removeItem: (key: string) => void;
}

const KEY = 'crm.calendar.connect';
/** A consent screen takes seconds; a note older than this is from a connect that never came back. */
const FRESH_MS = 10 * 60_000;

/** The tab's session storage, or nothing where the browser refuses it (a private window, blocked site data). */
export function sessionNotes(): NoteStore | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

/** Notes the accounts the page has before it goes to the provider (`now` for tests). Never throws. */
export function noteConnectStart(store: NoteStore | undefined, start: ConnectStart, now: number = Date.now()): void {
  try {
    store?.setItem(KEY, JSON.stringify({ ...start, at: now }));
  } catch {
    // Storage full or refused: the connect still works, the page just won't know which account is new.
  }
}

/** True when `value` is a list of strings. */
const isStringList = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((each) => typeof each === 'string');

/**
 * Reads the note once (it is removed as it is read) and says which account the connect made, against the
 * connections the page has now. Never throws.
 */
export function takeConnectArrival(
  store: NoteStore | undefined,
  connections: readonly string[],
  now: number,
): ConnectArrival {
  let raw: string | null;
  try {
    raw = store?.getItem(KEY) ?? null;
    store?.removeItem(KEY);
  } catch {
    return { kind: 'unknown' };
  }
  if (raw === null) return { kind: 'unknown' };
  let note: unknown;
  try {
    note = JSON.parse(raw);
  } catch {
    return { kind: 'unknown' };
  }
  if (typeof note !== 'object' || note === null) return { kind: 'unknown' };
  const { before, reconnecting, at } = note as Record<string, unknown>;
  if (!isStringList(before) || typeof at !== 'number' || now - at > FRESH_MS || now < at) return { kind: 'unknown' };
  if (typeof reconnecting === 'string' && connections.includes(reconnecting)) {
    return { kind: 'reconnected', connectionId: reconnecting };
  }
  const added = connections.filter((id) => !before.includes(id));
  const [only] = added;
  // Exactly one new account, or the connect landed on one already there (the same account again): nothing is new.
  return only !== undefined && added.length === 1 ? { kind: 'new', connectionId: only } : { kind: 'unknown' };
}
