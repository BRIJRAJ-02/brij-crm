// The one way a guest page's popups wear its look (spec 0074, batch 4, AC-7409): every React Aria overlay opened
// inside (Popover, Menu, Select, ComboBox, DatePicker, Tooltip, Modal in every variant) is portalled into a host at the
// end of the page's themed root rather than to `document.body`, so the root's theme, template, font, corners and
// colours (custom properties and `data-*` selectors alike) cascade into it with nothing copied. React Aria places a
// popover against its real containing block, so the host draws no box of its own (`display: contents`).
import { useState, type ReactNode } from 'react';
import { UNSAFE_PortalProvider } from 'react-aria';
import styles from './PopupHost.module.css';

/** Props for PopupHost. */
export interface PopupHostProps {
  /** The page's content: every overlay opened inside it portals into the host. */
  readonly children: ReactNode;
}

/**
 * Put inside a guest page's themed root, around its content. A popup in the app (no PopupHost around it) is
 * unchanged: it portals to `document.body` and wears the app's theme (AC-7410).
 */
export function PopupHost({ children }: PopupHostProps) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  return (
    <>
      <UNSAFE_PortalProvider getContainer={() => host}>{children}</UNSAFE_PortalProvider>
      <div ref={setHost} className={styles.host} data-popup-host="" />
    </>
  );
}
