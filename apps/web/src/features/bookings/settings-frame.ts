// Where a settings page stands when it is one of Bookings settings' (the mock's IA, 9 November 2026): the frame route
// puts the module's grouped navigation here, and the shared settings page draws it beside its body and names its
// trail Bookings › Settings, rather than the app's Settings sidebar and trail.
import { createContext, useContext } from 'react';
import type { BookingsSettingsPage } from '../booking/links.ts';
import type { BookingsSettingsEntry } from './settings-nav.ts';

/** Bookings settings' frame, as the settings page inside it reads it. */
export interface BookingsSettingsFrame {
  readonly slug: string;
  /** The entries this member may open, in their groups' order. */
  readonly nav: readonly BookingsSettingsEntry[];
  /** The page the address shows, if it is one of the entries. */
  readonly current: BookingsSettingsPage | undefined;
}

/** Bookings settings' frame; undefined anywhere else (the app's own Settings). */
export const BookingsSettingsFrameContext = createContext<BookingsSettingsFrame | undefined>(undefined);

/** The Bookings settings frame around this page, or undefined in the app's own Settings. */
export const useBookingsSettingsFrame = () => useContext(BookingsSettingsFrameContext);
