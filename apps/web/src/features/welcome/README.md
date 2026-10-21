# Welcome (first run)

Spec 0005, milestone 1 (AC-30), redesigned by spec 0036 (AC-1203 to AC-1214).

## `/welcome` (WelcomeScreen)

- **Purpose**: first run. A new person says who they are, names their workspace and may connect a calendar, watching the workspace take shape beside each step.
- **Main task**: About you, then Your workspace (Create workspace), then Connect your calendar or Skip for now, into People.
- **Leaves out**: inviting the team (after spec 0031 slice 2), a photo (file storage, #32), templates and use case questions; someone who already has a workspace is sent to it.

## The steps

- **About you** (`AboutStep`): "Your name" (Google's name, or empty) beside a round avatar whose initials follow it. Continue needs a name ("Enter your name, or skip this step."); Skip goes on without one. A member is never nameless: a skipped name is the account's, else one made from the email ("ada.lovelace@acme.com" gives "Ada Lovelace", `nameFromEmail`), else the email's first part (`memberNameFor`).
- **Your workspace** (`WorkspaceStep`): "Workspace name" follows your name ("Ada’s workspace") until edited, and "Web address" after "/w/" follows the workspace name (`slugFrom`: lowercase letters and digits in single dash runs, 3 to 40 characters) until edited; typed, the address turns lowercase and spaces become dashes (`addressAsTyped`). The address is checked 300 ms after the last key (`data.workspaces.slugAvailable`): a spinner and "Checking the address…", then a tick and "That address is free.", or "That address is taken. Try another." on the field; the settled answer is announced. An answer for an older address is dropped. A failed check (offline, too many) says nothing and leaves Create to decide. Create workspace refuses a missing name and a broken or known taken address on their fields before asking; the server still has the last word (`SLUG_TAKEN` on the address).
- **Connect your calendar** (`CalendarStep`, only where `system.status` says `calendarSync`): Connect Google Calendar leaves for the API's connect start with `then=welcome`, which comes back to `/welcome?step=calendar&workspace=<slug>&calendar=<result>`; the result shows as a callout (connected, then Continue; or why not, with Connect again). Connect Outlook is off, and the step's description ends "Outlook is coming soon.". Skip for now opens the workspace.

## Notes

- The step is in the address (`?step=about|workspace`), so the browser's back button moves between steps; Back (an icon button above the title, from the second step) goes back through the same history when it came from Continue, and keeps what was typed. Once the workspace is made, the calendar step has no Back: going back would mean renaming the workspace. The route keeps the calendar step for after the workspace exists (`?workspace=<slug>`, one of the person's own), and sends anyone else with a workspace to it.
- The card is AuthLayout's split card: `WorkspacePreview` on the right from 1024 px up (the workspace's initials tile and name, the person's avatar and name, the part the step is about ringed), "Step N of M" (Steps' `count`) above the title, and "Signed in as {email}" with Sign out at its foot. Sign out asks first (`features/auth/SignOutDialog.tsx`, the owner's rule of 21 October 2026): "Sign out?", Cancel (ESC) first, a primary Sign out last that spins while it runs and runs once.
- What was typed is kept in this tab's sessionStorage for the signed in person only (`draft.ts`), with the workspace's id, a UUID v7 minted once (`data.workspaces.newId()`) and sent again on every try, so a reload keeps the steps and a retry after a lost answer makes nothing twice. Making the workspace, or signing out, forgets it.
- Refusals land on their fields through Form's `fieldFor` (`refusals.ts`): `SLUG_TAKEN` on the web address (the API names the field), input problems by their path, anything else above the fields.
- A step change keeps the page, so the screen moves focus itself: the new step's first field (the calendar step's first working button). The first step shown is the route's to focus (`features/navigation/focus.ts`).
- Making the workspace loads the calendar step before showing it, so the card goes straight there; with calendar sync off, it opens People.
