// The one way a guest page's popups wear its look (spec 0074, batch 4, AC-7409): every React Aria overlay opened
// inside (Popover, Menu, Select, ComboBox, DatePicker, Tooltip, Modal in every variant) is portalled into a host at the
// end of the page's themed root rather than to `document.body`, so the root's theme, template, font, corners and
// colours (custom properties and `data-*` selectors alike) cascade into it with nothing copied. React Aria places a
// popover against its real containing block, so the host draws no box of its own.
import { useState, type ReactNode } from 'react';
import { UNSAFE_PortalProvider } from 'react-aria';

/** Props for PopupHost. */
export interface PopupHostProps {
  /** The page's content: every overlay opened inside it portals into the host. */
  readonly children: ReactNode;
  /**
   * The host's class, from the page's own stylesheet (so the hosted form and the booking page carry no stylesheet of
   * their own for it): `display: contents`, the guest bars' `--size-topbar`, and the accent names the page works out
   * one level in from its root, which the host is a sibling of.
   */
  readonly className: string | undefined;
}

/**
 * Put inside a guest page's themed root, around its content. A popup in the app (no PopupHost around it) is
 * unchanged: it portals to `document.body` and wears the app's theme (AC-7410). Never inside an `inert` subtree that
 * can open a popup: the popup would be inert too.
 */
export function PopupHost({ children, className }: PopupHostProps) {
  // The host in state, as GuestLook has kept it since spec 0065: an overlay already open on the very first render (a
  // dish's sheet opened from its link) is drawn on the document for that first frame, then moves into the host when
  // it appears, so it wears the page's look too. Moving mounts it again, which costs that one overlay its focus return
  // to the trigger; an overlay opened later (every other) is drawn in the host at once.
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  return (
    <>
      <UNSAFE_PortalProvider getContainer={() => host}>{children}</UNSAFE_PortalProvider>
      <div ref={setHost} className={className} data-popup-host="" />
    </>
  );
}
