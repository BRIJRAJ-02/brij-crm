# Navigation

Helpers, not a screen: what happens around every route change. `main.tsx` wires them to the router and the page.

## `focus.ts` (`focusPage`)

After a route change, focus goes to the new page's title, its one `h1` inside the main landmark, so a screen reader starts there and Tab continues from the top. The pages whose whole task is one field put focus in that field instead: the email on `/sign-in`, the first code box on `/verify`, so a phone's keyboard and its code suggestion come up at once. The first load moves nothing.

## `title.ts` (`followPageTitle`)

The tab's title is the page's `h1`, then the product: "People · CRM" (WCAG 2.4.2). It is set on the first load and follows the `h1` as it changes (a route change, a pending page resolving, a page that loads lazily), checked at most once a frame through a MutationObserver on the app's root.
