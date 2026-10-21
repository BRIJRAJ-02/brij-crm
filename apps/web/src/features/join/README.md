# join

`/join` (spec 0031, AC-819): the workspaces whose email domain is the signed in person's, in the sign in frame, outside any workspace. Signed out, sign in comes back here.

## JoinScreen

- **Purpose:** show a signed in person the workspaces at their email's domain they may ask to join.
- **Main task:** Ask to join one; it then says Request sent, and an email follows once an owner or admin approves.
- **Leaves out:** joining at once (an admin approves each request), other domains, and invitations (their own page).

Lean: the title ("Join your team") and one line naming the domain, then a DescriptionList, one row per workspace: its name, and Ask to join (a small Button that spins while it asks) or a "Request sent" Badge. Once any request is out, one quiet line says what happens next. A decline never says no here: it reads as sent for 30 days (AC-820). No workspace at the domain says so in the description, with the way back to the person's workspaces in the footer. A refusal (too many requests in an hour) shows in a danger Callout. The welcome page points here ("Your team may already be on Timefix", See workspaces) when any workspace matches.
