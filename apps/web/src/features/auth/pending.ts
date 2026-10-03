// The sign in waiting for its code (spec 0005, Value sourcing): the address
// the code went to and when, in sessionStorage, so `/verify` survives a
// reload in this tab and nowhere else. Cleared on verify or "Use another
// email". Storage can be missing or throw (a private window, blocked site
// data), so every read and write is guarded; without it, `/verify` sends the
// person back to `/sign-in`.

const KEY = 'crm.signIn.pending';

/** The address a code went to, and when (Unix milliseconds). */
export interface PendingSignIn {
  readonly email: string;
  readonly sentAt: number;
}

/** This tab's sessionStorage, or undefined when the browser refuses it. */
export function sessionStore(win: Window): Storage | undefined {
  try {
    return win.sessionStorage;
  } catch {
    return undefined;
  }
}

/** The sign in waiting for its code, or undefined. */
export function readPending(storage: Storage | undefined): PendingSignIn | undefined {
  try {
    const raw = storage?.getItem(KEY);
    if (raw === null || raw === undefined) return undefined;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const { email, sentAt } = parsed as { email?: unknown; sentAt?: unknown };
    return typeof email === 'string' && email !== '' && typeof sentAt === 'number' ? { email, sentAt } : undefined;
  } catch {
    return undefined;
  }
}

/** Remembers the address a code just went to. */
export function savePending(storage: Storage | undefined, pending: PendingSignIn): void {
  try {
    storage?.setItem(KEY, JSON.stringify(pending));
  } catch {
    // Without storage, a reload of /verify goes back to /sign-in.
  }
}

/** Forgets the waiting sign in. */
export function clearPending(storage: Storage | undefined): void {
  try {
    storage?.removeItem(KEY);
  } catch {
    // Nothing to forget.
  }
}
