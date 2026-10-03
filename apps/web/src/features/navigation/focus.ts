// Focus after a route change (spec 0005, every screen): the new page's title,
// its one h1 inside the main landmark (TopBar's in the app, the page card's
// before it). Both take focus by script and stay out of the tab order.

/** Moves focus to the page's title, if the page has one. */
export function focusPageTitle(doc: Document): void {
  doc.querySelector<HTMLElement>('main h1')?.focus();
}
