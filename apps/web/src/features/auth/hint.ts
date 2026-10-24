// Whether this browser had a session last time (the owner, 24 October 2026:
// "before checking it flashed the signup page"). The app is a single page app,
// so it cannot know there is a session until `me.get` answers; without a hint
// it drew sign in's screen first and replaced it. The hint, in localStorage so
// it survives a reload and a new tab, only decides which place to hold while
// that answer is on its way: the app's own loading state, or sign in's.
//
// It is a guess, never proof: `me.get` always overrules it, and nothing is
// read or shown on the strength of it. A session outlives a browser being
// closed, so `in` is kept with the moment it was written and counts for no
// longer than a session can last (the API signs people out after 30 days,
// `expiresIn` in apps/api/src/auth/auth.ts); past that the browser knows
// nothing again rather than holding the app's place for someone the server
// will refuse. Storage can be missing or throw (a private window, blocked site
// data), so every read and write is guarded; without it each page holds its
// own default place, which is never the wrong screen for someone signed in.

const KEY = 'crm.session';

/** As long as a session can last, after which `in` means nothing (apps/api `expiresIn`: 30 days). */
const IN_LASTS_MS = 30 * 24 * 60 * 60 * 1000;

/** What this browser last knew: `in` someone was signed in, `out` nobody was. */
export type SessionHint = 'in' | 'out';

/** This browser's localStorage, or undefined when it refuses it. */
export function localStore(win: Window): Storage | undefined {
  try {
    return win.localStorage;
  } catch {
    return undefined;
  }
}

/**
 * What this browser last knew about the session, or undefined: a first visit,
 * no storage, or an `in` older than a session can last.
 */
export function readSessionHint(storage: Storage | undefined, now = Date.now()): SessionHint | undefined {
  try {
    const held = storage?.getItem(KEY);
    if (held === 'out') return 'out';
    if (held === null || held === undefined || !held.startsWith('in:')) return undefined;
    const writtenAt = Number(held.slice(3));
    if (!Number.isFinite(writtenAt) || writtenAt <= 0) return undefined;
    // A clock moved back makes a hint look like the future: that is no reason to doubt it, only not to keep it long.
    return now - writtenAt < IN_LASTS_MS ? 'in' : undefined;
  } catch {
    return undefined;
  }
}

/** Remembers what the layer just learned, for the next load's first paint. */
export function writeSessionHint(storage: Storage | undefined, hint: SessionHint, now = Date.now()): void {
  try {
    storage?.setItem(KEY, hint === 'in' ? `in:${String(now)}` : 'out');
  } catch {
    // Without storage, each page holds its own default place, which is never the wrong screen.
  }
}
