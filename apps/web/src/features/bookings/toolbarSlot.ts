// Where a Bookings tab draws its tools: the end of the Calendar · List ·
// Availability strip, as Captures does (the owner's call, 20 October 2026).
// The layout owns the element; the tab's screen portals its toolbar into it,
// so the tools sit on the strip's hairline.
import { createContext, useContext } from 'react';

/** The strip's end, once the layout has drawn it. */
export const BookingsToolbarSlot = createContext<HTMLElement | null>(null);

/** The element a Bookings tab draws its toolbar into, or null before the layout has one (the tab then keeps its own). */
export const useBookingsToolbarSlot = () => useContext(BookingsToolbarSlot);
