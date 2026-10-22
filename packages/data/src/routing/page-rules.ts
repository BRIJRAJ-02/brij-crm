// A team page's routing rules as the data layer holds them (spec 0043, AC-1608), for the page's Routing card: one
// entry per workspace and page, filled by every answer that carries the page (the editor's `bookingPages.get` on
// arrival, an update's answer) and patched by `bookingPages.update` with rules: shown at once, put back on a refusal
// (only while it still shows that change), the answer put in place. It reads nothing itself: booking pages have no
// live event, and the editor's loader reads the page each time it opens, so no page list is read for it and no list
// cap can leave a page out.
import type { BookingPageView, RoutingRule } from '@crm/contracts';

/** One page's rules as a card retains them: undefined until an answer carrying the page arrives. */
export interface PageRulesHeld {
  readonly subscribe: (listener: () => void) => () => void;
  /** The page's rules as last shown; the same array until a write or an answer changes them. */
  readonly getSnapshot: () => readonly RoutingRule[] | undefined;
  /** Nothing to read: the entry is filled by the page's own answers. */
  readonly retain: () => () => void;
}

interface Entry {
  rules: readonly RoutingRule[] | undefined;
  readonly listeners: Set<() => void>;
  readonly held: PageRulesHeld;
}

/** The pages' rules: one entry per workspace and page, for the session (`clear` on sign out). */
export function createPageRules() {
  const entries = new Map<string, Entry>();

  const entryOf = (workspace: string, pageId: string): Entry => {
    const key = `${workspace} ${pageId}`;
    const found = entries.get(key);
    if (found !== undefined) return found;
    const listeners = new Set<() => void>();
    const entry: Entry = {
      rules: undefined,
      listeners,
      held: {
        subscribe: (listener) => {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
        getSnapshot: () => entry.rules,
        retain: () => () => undefined,
      },
    };
    entries.set(key, entry);
    return entry;
  };

  const set = (entry: Entry, rules: readonly RoutingRule[] | undefined) => {
    entry.rules = rules;
    for (const listener of entry.listeners) listener();
  };

  return {
    /** One page's rules, the same held view for the session. */
    view: (workspace: string, pageId: string): PageRulesHeld => entryOf(workspace, pageId).held,
    /** A page as the server answered it: a team page's rules replace what is held. */
    receive: (workspace: string, page: BookingPageView): void => {
      if (page.routing !== undefined) set(entryOf(workspace, page.id), page.routing.rules);
    },
    /** Shows `rules` at once; answers how to put back what was there, only while it still shows them. */
    show: (workspace: string, pageId: string, rules: readonly RoutingRule[]): (() => void) => {
      const entry = entryOf(workspace, pageId);
      const before = entry.rules;
      set(entry, rules);
      return () => {
        if (entry.rules === rules) set(entry, before);
      };
    },
    /** Forgets every page (sign in, sign out, a 401): a new session reads its pages afresh. */
    clear: (): void => {
      entries.clear();
    },
  };
}
