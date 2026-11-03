# Insights

Spec 0067: every public page's visits, finishes, sources and sessions, and numbers only share links.

## Screens

- **Insights** (`/w/$slug/insights`, `InsightsScreen.tsx`): for every form, booking page and the member's link page they may see, how many came, how many finished, where they came from and where they stopped, over 7, 30 or 90 days, 12 months or all time, against the equal period before. The page picker (`?kind=`, `?page=`) narrows every number. Sessions name a person only where the reader may already read that submission or booking. Export CSV saves what the screen shows; Share makes a link.
  - Main task: see whether a page works and which source brings people who finish.
  - Leaves out: live updates (a visit sends no change event; the page reads again on return), the product panels (menus, QR, reservations and events come with them) and goals and alerts. A custom period comes from the date range picker beside the five ranges.
- **Shared Insights** (`/public/insights#t=<token>`, `SharedInsightsScreen.tsx`): what a share link opens, signed in as no one. The token stays in the fragment and reaches the API in a header, so no log or Referer holds it.
  - Main task: a client or partner reads the numbers.
  - Leaves out: every person (no sessions, names, emails, free text, Other's sites or landing parameters), and changing the period or pages.

`InsightsBody.tsx` is the numbers half both share: the tiles, visits and finishes (paired bars, `Chart`'s `compareLabel`), the finish rate in its own chart (never a second axis), where people stop with the biggest drop named, and sources. `format.ts` holds the pure arithmetic and the CSV (formula safe).
