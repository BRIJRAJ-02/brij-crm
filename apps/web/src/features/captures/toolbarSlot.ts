// Where Booking pages and Forms draw their search: the end of the bar under the TopBar, the row People's views
// take (spec 0034; the end of Captures' tab strip before, the owner's call, 20 October 2026). The page's layout
// owns the element; the list portals its search into it, so the search sits on the bar's hairline while the list
// keeps the query.
import { createContext, useContext } from 'react';

/** The bar's end, once the layout has drawn it. */
export const CapturesToolbarSlot = createContext<HTMLElement | null>(null);

/** The element a list draws its search into, or null before the layout has one (the list then shows none). */
export const useCapturesToolbarSlot = () => useContext(CapturesToolbarSlot);
