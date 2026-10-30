// A view's draft (spec 0020, the draft in the URL, AC-466): the filter and
// sorts changed and not yet saved, kept in the address bar's `draft` (so a
// reload, back and forward and a copied link keep it), or only in this page's
// memory when it is too long for a link. Equal to the saved query, it is no
// draft. The draft remembers the view's query version when it began, which
// Save sends so a clash is never silent (AC-469). The data layer keeps each
// view's draft for the tab too, so leaving through the sidebar or another
// view and opening it again brings the draft back, Save and Discard showing.
import type { DraftQuery } from '@crm/data';
import { useRouteContext } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';

/** One draft: its query, its URL text (absent when too long for a link), and the view's query version it began on. */
interface Draft {
  readonly query: DraftQuery;
  readonly text: string | undefined;
  readonly base: number;
}

/** What the screen reads and does with its draft. */
export interface ViewDraft {
  /** What the table shows: the draft, or the saved query. */
  readonly query: DraftQuery;
  readonly isDraft: boolean;
  /** False while the draft is too long for a link: Copy link is off (milestone 2's view menu). */
  readonly isLinkable: boolean;
  /** The view's query version when the draft began. */
  readonly baseQueryVersion: number;
  /** A new draft: `push` adds a history entry (the first change of a Popover, a column's Sort), `replace` doesn't. */
  readonly set: (next: DraftQuery, how: 'push' | 'replace') => void;
  /** Back to the saved query. */
  readonly discard: () => void;
  /** The draft was saved: the saved query now holds it. */
  readonly settle: () => void;
}

/** What the hook needs: the saved query and its version, the URL's draft, and how to write it. */
export interface ViewDraftInput {
  readonly slug: string;
  /** The view the draft belongs to: its draft is kept in the data layer for this tab under this id. */
  readonly viewId: string | undefined;
  readonly saved: DraftQuery;
  readonly savedVersion: number;
  /** The `draft` search param now. */
  readonly param: string | undefined;
  /**
   * The draft the loader opened with, already checked: the link's, or with no `draft` in the address the one this
   * tab kept for the view (read through the same check, so a kept draft that no longer reads is never shown).
   */
  readonly opened: DraftQuery | undefined;
  /** Writes the `draft` param (undefined removes it). */
  readonly write: (param: string | undefined, replace: boolean) => void;
  /** A link's draft couldn't be read: the screen says so and the param goes. */
  readonly onUnreadable: () => void;
  /** Writes a query in its one form before comparing (the default order as no sorts); unchanged when absent. */
  readonly normalize?: (query: DraftQuery) => DraftQuery;
}

/** The view's draft over the route's `draft` search param. */
export function useViewDraft({
  slug,
  viewId,
  saved,
  savedVersion,
  param,
  opened,
  write,
  onUnreadable,
  normalize = (query) => query,
}: ViewDraftInput): ViewDraft {
  const { data } = useRouteContext({ from: '__root__' });
  // The same question in two forms (the default order stored, or asked as none) is no draft.
  const isSame = (a: DraftQuery, b: DraftQuery) => data.views.isSameQuery(normalize(a), normalize(b));
  const [draft, setDraft] = useState<Draft | undefined>(() => {
    if (param !== undefined)
      return opened === undefined ? undefined : { query: opened, text: param, base: savedVersion };
    // Opened with no draft in the address: the one this tab kept for the view, as the loader checked it (`opened`),
    // on the version it began on.
    const kept = viewId === undefined ? undefined : data.views.keptDraft(slug, viewId);
    return kept === undefined || opened === undefined
      ? undefined
      : { query: opened, text: data.views.draftParam(opened), base: kept.base };
  });
  // The param as this tab last wrote or read it: a different one came from back, forward or a typed address.
  const known = useRef(param);
  // A kept draft brought back goes into the address too, so a reload or a copied link keeps it.
  useEffect(() => {
    if (param !== undefined || draft?.text === undefined) return;
    known.current = draft.text;
    write(draft.text, true);
    // Once, for the draft the screen opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (param === known.current) return;
    known.current = param;
    if (param === undefined) {
      // Back or forward to the saved query: the address bar is the outside system this follows.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDraft(undefined);
      return;
    }
    let isCurrent = true;
    void data.views.readDraft(param).then((query) => {
      if (!isCurrent) return;
      if (query === undefined) {
        onUnreadable();
        return;
      }
      setDraft((held) => ({ query, text: param, base: held?.base ?? savedVersion }));
    });
    return () => {
      isCurrent = false;
    };
    // Only the URL moving starts this; the rest is read as it stands then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [param]);

  const go = (next: string | undefined, replace: boolean) => {
    known.current = next;
    write(next, replace);
  };
  const isDraft = draft !== undefined && !isSame(draft.query, saved);
  // The tab keeps what shows as a draft for the view, and forgets it once saved, discarded or equal to the saved.
  const kept = isDraft ? draft : undefined;
  useEffect(() => {
    if (viewId === undefined) return;
    data.views.keepDraft(slug, viewId, kept === undefined ? undefined : { query: kept.query, base: kept.base });
  }, [data, slug, viewId, kept]);
  return {
    query: isDraft ? draft.query : saved,
    isDraft,
    isLinkable: !isDraft || draft.text !== undefined,
    baseQueryVersion: isDraft ? draft.base : savedVersion,
    set: (next, how) => {
      if (isSame(next, saved)) {
        setDraft(undefined);
        go(undefined, how === 'replace');
        return;
      }
      const text = data.views.draftParam(next);
      setDraft((held) => ({ query: next, text, base: held?.base ?? savedVersion }));
      go(text, how === 'replace');
    },
    discard: () => {
      setDraft(undefined);
      go(undefined, false);
    },
    settle: () => {
      setDraft(undefined);
      go(undefined, true);
    },
  };
}
