// Where a settings page draws its TopBar (20 October 2026): the settings frame
// keeps the bar's place above the view, as every page's TopBar sits, and the
// page portals its own bar (its trail ends with its title) into it, since only
// the page knows its title. The Captures toolbar slot works the same way.
import { createContext, useContext } from 'react';

/** The settings frame's bar host, once drawn; null before (the page then draws no bar for that frame). */
export const SettingsTopBarSlot = createContext<HTMLElement | null>(null);

/** The element a settings page draws its TopBar into, or null before the frame has one. */
export const useSettingsTopBarSlot = () => useContext(SettingsTopBarSlot);
