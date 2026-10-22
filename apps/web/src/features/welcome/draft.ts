// What first run's steps have typed, kept in this tab's sessionStorage
// (spec 0036, AC-1210), so a reload keeps it, and with it the workspace's id,
// so a retry after a lost answer never makes two workspaces. Kept for the
// signed in person only: another person in the same tab starts afresh. Made
// once the workspace exists, it is forgotten. Storage can be missing or throw
// (a private window, blocked site data), so every read and write is guarded;
// without it, a reload starts the steps again.

const KEY = 'crm.welcome.draft';

/** A workspace id as `data.workspaces.newId()` mints it: a UUID v7. */
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** First run's typing so far. A field left out still follows its suggestion. */
export interface WelcomeDraft {
  /** Whose draft it is. */
  readonly userId: string;
  /** The id the workspace is made with, the same on every try. */
  readonly workspaceId: string;
  readonly memberName?: string;
  readonly workspaceName?: string;
  readonly slug?: string;
}

/** The draft kept for `userId`, or undefined when there is none, it is someone else's, or it can't be read. */
export function readDraft(storage: Storage | undefined, userId: string): WelcomeDraft | undefined {
  try {
    const raw = storage?.getItem(KEY);
    if (raw === null || raw === undefined) return undefined;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const { userId: owner, workspaceId, memberName, workspaceName, slug } = parsed as Record<string, unknown>;
    if (owner !== userId || typeof workspaceId !== 'string' || !UUID_V7.test(workspaceId)) return undefined;
    const text = (value: unknown) => (typeof value === 'string' ? value.slice(0, 80) : undefined);
    const [name, workspace, address] = [text(memberName), text(workspaceName), text(slug)];
    return {
      userId,
      workspaceId,
      ...(name === undefined ? {} : { memberName: name }),
      ...(workspace === undefined ? {} : { workspaceName: workspace }),
      ...(address === undefined ? {} : { slug: address }),
    };
  } catch {
    return undefined;
  }
}

/** Keeps what has been typed. */
export function saveDraft(storage: Storage | undefined, draft: WelcomeDraft): void {
  try {
    storage?.setItem(KEY, JSON.stringify(draft));
  } catch {
    // Without storage, a reload starts the steps again.
  }
}

/** Forgets the draft: the workspace is made, or someone else signed in. */
export function clearDraft(storage: Storage | undefined): void {
  try {
    storage?.removeItem(KEY);
  } catch {
    // Nothing to forget.
  }
}
