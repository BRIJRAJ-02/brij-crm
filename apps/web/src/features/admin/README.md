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

## One booking page (`/w/$slug/settings/admin/booking-pages/$pageId`, PageScreen)

- **Purpose**: one page's facts and its figures against the period before, by day.
- **Main task**: judge how one page is doing.
- **Leaves out**: the page's settings, which stay in its owner's editor.

## Website (`/w/$slug/settings/admin/website`, SiteScreen)

- **Purpose**: the marketing site's visitors and page views, by day, with its top pages, referrers, sources, countries and devices.
- **Main task**: see how many people visit and where they come from.
- **Leaves out**: who a visitor is (a daily id, never an address or a cookie).

## Notes

- Every page has the period switch (7, 30 or 90 days, kept as `?period=`, 30 by default) at the bar's end, and reads fresh through `data.operator.*`: no cache and no live event, the numbers are a snapshot of a period.
- The users list keeps its search (`?q=`, read 250 ms after typing rests) and how many rows show (`?shown=`, Show more adds 50, at most 1,000) in the address, so Back and a reload show the same list.
- Days are UTC. A day chart is BarStrip's `chart` size, every bar named with its day and count for screen readers and in its tooltip.
- States: each page's loading layout; empty tables and charts; no visits yet (the site isn't counting); not a super admin (Settings' "nothing here"); two factor missing (a link to Sign in and devices); an old sign in (confirm it's you, here); any other failure with Retry.
