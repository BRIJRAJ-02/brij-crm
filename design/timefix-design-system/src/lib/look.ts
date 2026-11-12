// A guest look's theme and token overrides, handed down to the popups a themed page opens. Popovers, dialogs and drawers draw in a
// layer outside the page, so without this a dark menu's select or sheet would open in the app's own light theme.
import { createContext, type CSSProperties } from 'react';

/** A look as a root carries it: its theme (left out, the app's) and its token overrides (menuLookProps, guestLookProps, a link page's look). */
export interface LookScope { readonly 'data-theme'?: 'light' | 'dark'; readonly style: CSSProperties }
/** The nearest themed page's look (the menu, business, reservation, link and form pages); popups opened inside it wear it too. Undefined in the app. */
export const LookContext = createContext<LookScope | undefined>(undefined);
