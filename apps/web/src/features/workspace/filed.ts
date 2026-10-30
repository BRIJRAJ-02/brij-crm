// The filed notice (spec 0059, AC-5920): a create or an edit of this tab
// linked people to their companies by their emails' domains. main.tsx raises
// it, so it is in the first load with only its own words. Its Undo takes back
// just the link (and a company the write made), never the edit itself; Cmd+Z
// undoes both. Pure, so the node tests cover it.
import type { FiledNotice, UnfileOutcome } from '@crm/data';
import type { ToastContent } from '@crm/ui';

/** How long the toast stays, paused while hovered or focused: an Undo's 10 seconds, so a run of creates never piles up. */
export const FILED_TOAST_MS = 10_000;

/** The filed notice's words, and what its Undo did. */
export const filedStrings = {
  undo: 'Undo',
  linked: (name: string) => (name === '' ? 'Linked to their company.' : `Linked to ${name}.`),
  added: (name: string) => (name === '' ? 'Added their company and linked it.' : `Added ${name} and linked it.`),
  linkedMany: (count: number) => `Linked ${String(count)} people to their companies.`,
  /** The link taken back; with the company the write made, that went to the trash too. */
  unlinked: (name: string) => (name === '' ? 'Removed the company link.' : `Removed the link to ${name}.`),
  unlinkedMany: (count: number) => `Removed ${String(count)} company links.`,
  removed: (name: string) => (name === '' ? 'Removed the company it added.' : `Removed ${name}.`),
  /** A company the write made, kept: something else links to it now. */
  inUse: (count: number) =>
    count === 1
      ? 'The company stays: other records link to it now.'
      : `${String(count)} companies stay: other records link to them now.`,
  /** Company changed since the write: nothing was undone there. Never says who (it may be the person, in another tab). */
  keptSince: (count: number) =>
    count === 1
      ? 'Company was changed since, so it was kept.'
      : `${String(count)} people’s Company was changed since, so it was kept.`,
  gone: 'That link can’t be undone any more.',
} as const;

/** "Linked to Acme." or "Added Acme and linked it.", or for a paste, how many people were linked. */
function filedWords(notice: FiledNotice): string {
  const [only] = notice.companies;
  if (notice.companies.length !== 1 || only === undefined) return filedStrings.linkedMany(notice.companies.length);
  return only.made ? filedStrings.added(only.name) : filedStrings.linked(only.name);
}

/** The toast once a write filed people under their companies (AC-5920), with Undo, which `onUndo` runs. */
export function filedToast(notice: FiledNotice, onUndo: () => void): ToastContent {
  return {
    tone: 'success',
    message: filedWords(notice),
    action: { label: filedStrings.undo, onAction: onUndo },
  };
}

/**
 * The toast after a filing's Undo: what it took back, and what it kept because Company changed since or the
 * company it made is linked from elsewhere now. Nothing when every link was refused for another reason (those
 * raised their own toast with Retry).
 */
export function unfiledToast(outcome: UnfileOutcome): ToastContent | undefined {
  if (outcome.kind === 'gone') return { tone: 'danger', message: filedStrings.gone };
  const parts = [
    outcome.unlinked === 0
      ? undefined
      : outcome.trashed > 0 && outcome.unlinked === 1
        ? filedStrings.removed(outcome.name)
        : outcome.unlinked === 1
          ? filedStrings.unlinked(outcome.name)
          : filedStrings.unlinkedMany(outcome.unlinked),
    outcome.inUse > 0 ? filedStrings.inUse(outcome.inUse) : undefined,
    outcome.kept > 0 ? filedStrings.keptSince(outcome.kept) : undefined,
  ].filter((part) => part !== undefined);
  if (parts.length === 0) return undefined;
  return { tone: outcome.unlinked === 0 ? 'danger' : 'success', message: parts.join(' ') };
}
