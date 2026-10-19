// Where a Captures tab draws its search and New: the end of the Links · Forms
// strip (the owner's call, 20 October 2026). The layout owns the element; the
// tab's list portals its toolbar into it, so the tools sit on the strip's
// hairline while the list keeps its search.
import { createContext, useContext } from 'react';

/** The strip's end, once the layout has drawn it. */
export const CapturesToolbarSlot = createContext<HTMLElement | null>(null);

/** The element a Captures tab draws its toolbar into, or null before the layout has one (the list then keeps its own). */
export const useCapturesToolbarSlot = () => useContext(CapturesToolbarSlot);
