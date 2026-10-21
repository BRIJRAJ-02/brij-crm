import { createContext } from 'react';

/**
 * True directly in a page's body that sits inside the page's space-16
 * gutter (every Settings page, SettingsLayout): row like parts (a Table's
 * rows, a Tabs strip, a Disclosure's title row) then run their rows out
 * into the gutter, to the page's edges, and keep their text on the content
 * edge, where a section's heading, a Card's border and a Meter start. A
 * box that frames its own content (Card, Modal, Popover, Panel) sets it
 * back to false, so a table inside a card keeps to the card; any new part that
 * frames its own content (a column, a box) must set it back too.
 */
export const PageEdge = createContext(false);
