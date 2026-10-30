// Where a site's icon comes from. Its own module, apart from context.ts, so the
// pages that never draw a domain or a link (the hosted form, the booking page)
// don't carry it.
import { createContext, useContext } from 'react';

/**
 * A site's icon by its host ("acme.com"), served from the app's own origin: the web app supplies it for the
 * open workspace, and a domain or link chip shows it before its words. Undefined draws no icon.
 */
export const SiteIconsContext = createContext<((host: string) => string | undefined) | undefined>(undefined);

/** The icon address for a host, when the app says where site icons come from. */
export function useSiteIcons(): ((host: string) => string | undefined) | undefined {
  return useContext(SiteIconsContext);
}
