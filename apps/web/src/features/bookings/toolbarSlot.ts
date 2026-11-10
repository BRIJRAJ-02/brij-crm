// Where a Bookings tab draws its tools: the end of the Calendar · List ·
// Availability strip, as Captures does (the owner's call, 20 October 2026).
// The layout owns the element; the tab's screen portals its toolbar into it,
// so the tools sit on the strip's hairline.
import type { BookingHosts } from '@crm/data';
import { createContext, useContext } from 'react';

/** The strip's end, once the layout has drawn it. */
export const BookingsToolbarSlot = createContext<HTMLElement | null>(null);

/** The element a Bookings tab draws its toolbar into, or null before the layout has one (the tab then keeps its own). */
export const useBookingsToolbarSlot = () => useContext(BookingsToolbarSlot);

/**
 * The TopBar's end on a tab whose primary action is its own (Availability's New schedule, the owner, 22 October
 * 2026: one primary per screen): the tab portals its button there, in place of New meeting.
 */
export const BookingsActionSlot = createContext<HTMLElement | null>(null);

/** The TopBar's end for the tab's own primary action, or null where the TopBar keeps New meeting. */
export const useBookingsActionSlot = () => useContext(BookingsActionSlot);

/** Whose bookings an admin sees, and how they change it (HostsSwitch, on the strip); absent for anyone else. */
export interface HostsChoice {
  readonly value: BookingHosts;
  readonly onChange: (next: BookingHosts) => void;
}

/**
 * Mine or Everyone, owned by the Bookings layout so one switch stands still on the strip as Calendar and List swap
 * (a switch in each tab's own tools moved with them, a layout shift). Undefined for anyone but an admin.
 */
export const BookingsHosts = createContext<HostsChoice | undefined>(undefined);

/** The layout's Mine or Everyone, for the Calendar and List tabs' reads; undefined for anyone but an admin. */
export const useBookingsHosts = () => useContext(BookingsHosts);

/**
 * Opens New booking page, held by the Bookings layout (its dialog sits with the TopBar's New): the TopBar's New menu,
 * Pages' empty list and the Calendar's empty state all open the one dialog. Undefined outside the layout.
 */
export const BookingsNewPage = createContext<((kind?: 'page' | 'workspace' | 'team-link') => void) | undefined>(
  undefined,
);

/** The layout's New booking page, or undefined outside Bookings. */
export const useBookingsNewPage = () => useContext(BookingsNewPage);

/**
 * Whether Bookings may offer Connect calendar: false when the deployment has calendar sync off and nothing is
 * connected, so every Connect calendar link and notice hides rather than leading to a page that can only say so
 * (the bookings critique, A2). True outside the layout, so a screen rendered alone keeps its links.
 */
export const BookingsCalendarSync = createContext<boolean>(true);

/** Whether Bookings may offer Connect calendar. */
export const useCanConnectCalendar = () => useContext(BookingsCalendarSync);
