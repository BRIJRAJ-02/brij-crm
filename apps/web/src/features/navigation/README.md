# Navigation

Helpers, not a screen: what happens around every route change. `main.tsx` wires them to the router and the page.

## `focus.ts` (`focusPage`)

After a route change, focus goes to the new page's title, its one `h1` inside the main landmark, so a screen reader starts there and Tab continues from the top. The pages whose whole task is a form put focus in its first field instead: the email on `/sign-in`, the first code box on `/verify`, your name on `/welcome`, so a phone's keyboard and its code suggestion come up at once. The first load does the same on those pages and moves nothing anywhere else.

## `preload.ts` (`startIntentPreload`)

A page's code and data load while the pointer rests on the way into it, not after the click. The router's own `defaultPreload: 'intent'` only reaches its own `Link`, and the app's links are React Aria links (the sidebar, ButtonLink, breadcrumbs) while tabs and list rows navigate on selection. So the document listens: a pointer resting 50 ms on an `a[href]`, or on an element naming its destination as `data-href` (a Tabs item's or a LinkList row's `href`), preloads that address through `router.preloadRoute`, which loads the route's chunk and runs its loader, priming the data layer. A keyboard focus or a touch preloads at once. Other origins, `/api`, new tabs and downloads are left alone.

## `title.ts` (`followPageTitle`)

The tab's title is the page's `h1`, then the product: "People · CRM" (WCAG 2.4.2). It is set on the first load and follows the `h1` as it changes (a route change, a pending page resolving, a page that loads lazily), checked at most once a frame through a MutationObserver on the app's root.

## `LeaveGuard.tsx`

Leaving an editor with unsaved changes asks first, in the app's own danger Modal like every other ending action, never the browser's confirm: "Leave without saving?", Keep editing (Esc, first) or Leave without saving. Closing or reloading the tab asks the browser's way (`enableBeforeUnload`), only while something is unsaved. The booking page editor passes `searchStays`, so moving between its `?tab=` tabs never asks; Availability's `?schedule=` opens another schedule, so it does. Used by the booking page editor, Availability and Settings › Profile. A navigation that follows a delete passes `ignoreBlocker`, since nothing is left to save. The words are in `strings.ts`.
