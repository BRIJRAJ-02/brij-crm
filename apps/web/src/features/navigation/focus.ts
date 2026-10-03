// Focus after a route change (spec 0005, every screen): the new page's title,
// its one h1 inside the main landmark (TopBar's in the app, the page card's
// before it), which takes focus by script and stays out of the tab order.
// The pages whose whole task is one field (the email on /sign-in, the code
// on /verify) put focus in that field instead, so a phone's keyboard and its
// code suggestion come up at once; the field's label and the page's heading
// are read with it.

/** The one field each one field page focuses, by path. */
const FIRST_FIELD: Readonly<Record<string, string>> = {
  '/sign-in': 'main input[name="email"]',
  '/verify': 'main input[autocomplete="one-time-code"]',
};

/** Moves focus to the page's one field on a one field page, else to its title, if the page has one. */
export function focusPage(doc: Document, pathname: string): void {
  const field = FIRST_FIELD[pathname];
  const target =
    (field === undefined ? null : doc.querySelector<HTMLElement>(field)) ?? doc.querySelector<HTMLElement>('main h1');
  target?.focus();
}
