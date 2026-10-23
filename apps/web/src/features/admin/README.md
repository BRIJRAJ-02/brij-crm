# Super admin

Spec 0047, slice 1 of the operator console (scope #39). Read only analytics across every workspace, for the people on the api's `OPERATOR_EMAILS`. They live in Settings, in a Super admin group only super admins see (`me.get`'s `isOperator`); every read is checked again by the api, which also asks for two factor and a sign in within 12 hours, and logs it.

## Overview (`/w/$slug/settings/admin`, OverviewScreen)

- **Purpose**: the whole app's numbers for a period: people, activity and usage.
- **Main task**: see whether people sign up, come back and use the product, against the period before.
- **Leaves out**: any one person or workspace, booking pages and the website, each on its own page.

## Users (`/w/$slug/settings/admin/users`, UsersScreen)

- **Purpose**: every account, newest first, with what it did in the period.
- **Main task**: find a person by name or email and open their page.
- **Leaves out**: changing an account (support access, plans and suspension are later slices).

## One person (`/w/$slug/settings/admin/users/$userId`, UserScreen)

- **Purpose**: one account's facts, the days it was active, and each workspace with what it made there.
- **Main task**: understand one customer's usage before writing to them.
- **Leaves out**: anything they wrote: records, notes, tasks and bookings show only as counts.

## Booking pages (`/w/$slug/settings/admin/booking-pages`, PagesScreen)

- **Purpose**: every booking page together, by day, then each page: views, visitors, bookings, cancelled and the share of visitors who booked.
- **Main task**: see which pages people look at and which convert; open one for its days.
- **Leaves out**: who visited or booked, and changing a page.

## One booking page (`/w/$slug/settings/admin/booking-pages/$workspaceId/$pageId`, PageScreen)

- **Purpose**: one page's facts and its figures against the period before, by day.
- **Main task**: judge how one page is doing.
- **Leaves out**: the page's settings, which stay in its owner's editor.

## Website (`/w/$slug/settings/admin/website`, SiteScreen)

- **Purpose**: the marketing site's visitors and page views, by day, with its top pages, referrers, sources, countries and devices.
- **Main task**: see how many people visit and where they come from.
- **Leaves out**: who a visitor is (a daily id, never an address or a cookie).

## Notes

- Every page has the period switch (7, 30 or 90 days, kept as `?period=`, 30 by default) at the bar's end. Each read is held in the data layer (`data.operator.*`, `packages/data/src/operator/store.ts`): the route's loader warms it on the way in, and the screen holds it through `useOperator`, so a new period or search loads in place, the switch and the search field keeping their focus. An answer is kept for the app load and read again behind itself when asked for after a minute. No live event: the numbers are a snapshot of a period.
- The users list keeps its search in the address (`?q=`, read 250 ms after typing rests). Show more reads the next 50 and appends them; the badge says how many show of how many ("Showing 100 of 1,234"), and once the last page is in, focus moves to the search.
- Days are UTC. A day chart is BarStrip's `chart` size in a Card whose line says its total and busiest day in words; every bar names its day and count for screen readers and in its tooltip.
- A workspace's live records are counted to 100,000 at most ("100,000+"). The booking pages list holds the 500 most viewed.
- States: each page's loading shape (its figures, charts and tables as skeletons), in place on a new period; empty tables and charts; the website never counted ("No visits yet"), while a quiet period still shows its empty lists; not a super admin (Settings' "nothing here"), and a person or page that isn't there (its own page for a super admin, "nothing here" for anyone else); two factor missing (a link to Sign in and devices); a session not proven with the app lately (Confirm it's you, a code in a dialog); any other failure with Retry.
