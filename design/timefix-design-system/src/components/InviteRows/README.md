InviteRows is the one way to invite people by email, everywhere: a row per person with their role, and "+ Add another" to add the next.

**Use it for**: the Invite people dialog, first run's team step, any place people are added by email. **Don't use it for**: adding records (use a form) or picking existing members (use MultiSelect).

**The consumer provides**: `onSend(invites)` (show the toast there; return a promise to spin the button), `onChange(valid)` for a live preview, `roles` (Owner, Admin, Member with one-line descriptions by default; an empty list hides the column), `defaultRole`, `max` (20), `showSend` (off when the page's own Continue sends), `autoFocus`, `isDisabled`.

**States**: one empty row, several rows, a pasted list, an invalid row, full ("Up to 20 at a time."), sending.

**Interaction**: Enter moves to the next row, adds one from the last filled row, and sends from an empty last row. A pasted list ("Ava Chen <ava@globex.com>, sam@northwind.com") splits into rows that drop in 40ms apart; a new row takes the role of the row above it. Rows drop in (0fr to 1fr with a 12px rise, 250ms) and collapse the same way when removed, focus going to the row before. Send checks every row: bad addresses turn red, shake (transitions.dev 12) on every press and take focus.

**Replaces**: InviteRows (and InviteDialog's rows).
