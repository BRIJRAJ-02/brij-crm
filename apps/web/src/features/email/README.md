# Email preferences

The emails lane. The pages sit in `AuthLayout`, as the pages before the app do. They go through `data.emailPreferences(token)` and `data.emailUnsubscribe(token)`, which the loader awaits: their store loads with the page, outside the first load.

## `/email-preferences#t=<token>` (EmailPreferencesScreen)

- **Purpose**: the page an optional email's "Email preferences" link opens, with no sign in: which optional emails this member gets from this workspace.
- **Main task**: turn a topic on or off. It saves the moment it changes, and a refused change goes back with the reason above the switches.
- **Leaves out**: the emails that always come (sign in, account alerts, bookings, invitations), other members' choices, and signing in.

## `/email-preferences#u=<token>` (EmailUnsubscribeScreen)

- **Purpose**: the page an optional email's one click unsubscribe (RFC 8058, its `List-Unsubscribe` header) opens when a mail app opens the address in a browser instead of posting to it.
- **Main task**: say yes ("Unsubscribe"), and that email's topic is off. Then it says what is off and in which workspace.
- **Leaves out**: the member's other choices, which this link can't read or change, and signing in.

## Notes

- Both tokens ride in the fragment, so no request, server log or Referer holds them, and the data layer sends them to the API in a header. Each is signed for its own use, and neither opens the other's page.
  - `t` is the footer link's token: a workspace, a member and the email's topic, good for a year. It opens only that member's own choices (the door's `enterEmailLink`, no permission to anything else).
  - `u` is the one click's. A mail service posts it from the address's query, so request logs keep it, which is why it can only turn its own topic off.
- A link that is forged, expired, or for a member no longer in the workspace says "This link has expired" with no retry; any other failure offers Try again.
- The unsubscribe page sends nothing until the reader presses Unsubscribe: link scanners open addresses too, and a page that acted on load would unsubscribe people who never asked.
- The topic of the email the link came from is listed first.
- The topics are `EMAIL_TOPICS` in `@crm/contracts/emails`, the one list. Their words are in `strings.ts`, keyed by topic, so a topic added there fails the typecheck here until it has words.
- A failed load is the pages before the app's own (`AuthError`): the page's title, "Can’t reach Timefix. Check your connection, then try again." in an announced danger Callout, and a primary full width Try again that spins while the route runs again. An expired link, on either page, says "This link has expired" as the title with why under it, as the invitation page's dead link does, so no second heading sits under the page's (design sweep, 22 October 2026).
