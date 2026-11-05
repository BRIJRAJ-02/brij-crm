// The guest pages' one look (5 November 2026): what the guest menu wears, around a page built from the booking parts, so
// the menu, the reservation page and the business page read as one product. It draws nothing of its own.
import { useState, type ReactNode } from 'react';
import { UNSAFE_PortalProvider } from 'react-aria';
import '@crm/tokens/packs.css';
import styles from './GuestLook.module.css';

/** Props for GuestLook. */
export interface GuestLookProps {
  readonly children: ReactNode;
}

/**
 * Wears the guest menu's look around a page: the library's own names (surfaces, lines, words and the accent) point at
 * the `--menu-*` custom properties the menu's look stylesheet sets, each falling back to a token, the accent to the ink,
 * never the app's blue. Dialogs open inside it, so they wear it too. It lives apart from the parts it dresses, so a page
 * without it (the booking page) carries none of its styles.
 */
export function GuestLook({ children }: GuestLookProps) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  return (
    <div className={styles.root}>
      <div className={styles.names} ref={setHost}>
        <UNSAFE_PortalProvider getContainer={() => host}>{children}</UNSAFE_PortalProvider>
      </div>
    </div>
  );
}
