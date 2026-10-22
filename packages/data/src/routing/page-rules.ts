// A team page's routing rules as the data layer holds them (spec 0043, AC-1608), for the page's Routing card: one
// entry of the held booking page list, the one copy every page write patches. A rule added, moved or removed
// (`bookingPages.update` with `routing`) shows at once, goes back on a refusal, and the server's answer is put in
// place, so the card never waits on, or keeps, a copy of its own. Booking pages have no live event; the list is read
// again when held after a while away, like Captures › Links.
import type { BookingPageView, RoutingRule } from '@crm/contracts';
import type { CaptureListView } from '../captures/list.ts';

/** One page's rules as a card retains them: the held list's entry, or undefined until the list holds the page. */
export interface PageRulesHeld {
  readonly subscribe: (listener: () => void) => () => void;
  /** The page's rules as last shown; the same array until a write or a read changes the page. */
  readonly getSnapshot: () => readonly RoutingRule[] | undefined;
  /** Holds the booking page list while the card shows: read when first held, unless a read just landed. */
  readonly retain: () => () => void;
}

/** The rules of page `pageId`, read from a held booking page list (`bookingPages.view`). */
export function pageRulesOf(list: CaptureListView<BookingPageView>, pageId: string): PageRulesHeld {
  return {
    subscribe: list.subscribe,
    getSnapshot: () => {
      const state = list.getSnapshot();
      return state.status === 'ready' ? state.items.find((page) => page.id === pageId)?.routing?.rules : undefined;
    },
    retain: list.retain,
  };
}
