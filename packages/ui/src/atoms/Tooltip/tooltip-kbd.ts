import { createContext } from 'react';

/**
 * The shortcut a Tooltip shows for its trigger (`kbd`, Mac symbols), so a library control inside it states the same
 * shortcut through `aria-keyshortcuts`: sight and screen readers learn one key. Its own module, with no React Aria,
 * so Button reads it without bringing the tooltip's overlay code into the first load.
 */
export const TooltipKbdContext = createContext<string | undefined>(undefined);
