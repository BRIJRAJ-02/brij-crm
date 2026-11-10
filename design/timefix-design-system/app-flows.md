# Timefix flows (origin/main, 10 Nov 2026)

How people move through the app, end to end, as built on main. Every flow is to be rebuilt in the prototype in the new design language and improved with the design skills (journey, organize, ux-heuristics, subtractive-design, impeccable, interaction-design). Sources are the e2e flows in `apps/web/e2e/`, the feature READMEs and the specs.

**Gates**:
- Main has no billing or plans and no early access.
- Gates come from the environment (Google sign in, calendar sync, Outlook) and from permissions:
  - `schema.manage`, `access.manage`, `members.invite`, `teams.manage`, `security.manage`, `audit.read`;
  - Super admin for operators only.
- Parked: Automations, Webhooks, Background jobs.

## 1. Sign in and sign up
One passwordless door.
1. `/` shows a skeleton, then goes to the last workspace or to /sign-in.
2. Sign in with Google, or with an email and a 6-digit code on /verify, which checks itself once complete. "Use a different email" goes back.
3. A new person goes to /welcome; a returning person goes to their workspace.

- Errors:
  - A bad address marks the field.
  - Sign up closed, too many codes, or a server error show as a banner.
  - Resend is rate limited.
- An expired session loses the edit in flight; you sign in again and land back on the same page.

## 2. Two factor
- **Turn on**:
  1. Sign in and security › Set up. This needs a fresh verification.
  2. Scan the QR code, or use the setup key, then enter the first code.
  3. Backup codes are shown once; Done waits for "I've saved these".
- **Next sign in**: /two-factor with the app code or a backup code, and "Remember this device for 30 days".
- **Workspace requirement**: under Sign in rules. Members without it get a full page with Set up now.
- **Devices**: revoke one, or sign out of all other devices. A new device sends an email alert.

## 3. First run
/welcome is one split card with a live preview. Its steps:
1. Your name.
2. Workspace: the name and the /w/ address.
3. Booking page: name and length.
4. Link page: claim the handle.
5. Calendar, only when sync is on.
6. Invite your team.

Then "You're live", with the booking link and the link page, and on to Home. Home has a "Finish setting up" checklist. Create workspace opens /welcome?another=1.

## 4. Teammates, roles, teams, guests
- **Invite**: one row per email, a role, folded role guide. The invitation becomes an Invited row with Resend or Revoke.
- **Accepting**: /invite/$token reads "X invited you". The wrong account is refused; a used link reads "no longer valid".
- **Other ways in**:
  - An invite link with a role, expiry and max uses.
  - A company email domain: /join › Ask to join, and an admin approves.
- **Roles**:
  - Change inline. Lowering someone to Guest confirms and counts the pages it pauses.
  - Transfer ownership. Leave workspace.
- **Remove a member**: counts what they hold, with an optional reassign.
- **Teams**: create, rename, delete with Undo. Delete is refused while an access rule uses the team.
- **Object access**: Can see and Can edit per role or team; a record scope; folded field rules; Preview as.
- **Guests** land on "Nothing shared yet". History shows changes as sentences.

## 5. Records and objects
- **New record**: from "New", the ghost row or ⌘K.
  - The dialog asks for the primary and required fields.
  - A duplicate hint shows but never blocks.
  - The row appears marked New, with a toast and Open. "Create more" keeps the dialog open.
- **Editing**: cells edit in place and refusals show in the cell. An edit clash offers "Use mine". ⌘Z undoes. Others' changes arrive live.
- **New object**: names, icon and colour. It opens on Attributes, then the table, which can switch to a board. Archive confirms; Restore.
- **Attributes**: 17 types; formula, rollup and lookup are computed. Changing a type checks every value first.

## 6. Views, board, filters, bulk, trash, duplicates
- **Views**:
  - A filter or sort makes a draft; Save or Discard.
  - Clash dialog; private or shared, lock, duplicate, delete with Undo, set as default.
  - Footer calculations.
- **Board**: group by status, drag cards, add a stage, fold a column, "+" in a column.
- **Record panel**: ↑/↓, Esc, Open full page.
- **Bulk**:
  - Tick rows or select all matching.
  - Edit several fields with one Undo, Delete with Undo, Add to list, Export.
  - Big jobs are counted, confirmed, then done.
- **Trash**: restore, or say why it can't. Delete forever; empty.
- **Duplicates**: a list of pairs, Merge (pick values) or Not a duplicate.
- **Lists**: Blank or Pipeline; add from a record, the bulk bar or ⌘K; "Each record once"; archive.

## 7. Import and export
- **Import**:
  1. Choose a CSV.
  2. Match columns: they auto-match, a missing required field is named, ambiguous dates are asked, a column can become a new attribute.
  3. Review values: create an option, map labels, leave cells empty, read currency.
  4. Preview the new and updated counts.
  5. Start, then a summary page with Undo import.
- **Export**: a view's columns, plus hidden ones, then Download; or the ticked rows.

## 8. Record page
- Tabs: Overview, Activity, Notes, Tasks, Comments, Files. Delete with Undo, Restore banner, Related sections.
- **Notes**: a window that autosaves; link records.
- **Log activity**: a call or a meeting in two clicks.
- **Tasks**: quick add, or the dialog; tick with Undo.
- **Comments**: threads, @mentions, Resolve.
- **Files**: drop, download, delete with Undo.

## 9. Inbox and my tasks
- **Inbox**:
  - Inbox / Done; Mentions, Replies, Assignments; Unread only; Due today.
  - A row marks itself read and opens the thread or the task.
  - Booking notices arrive here too.
- **My tasks**: Overdue, Today, Upcoming, No date.
- **Notifications**: switches with Undo. Email preferences work without signing in.

## 10. Forms
1. New form opens a gallery: Blank plus 11 templates.
2. Editor tabs: Form, Settings, Share, Submissions, Analytics.
   - Questions map to attributes.
   - Logic is written as sentences; "After they send" rules.
3. Publish.
   - The first is one click, then "Your form is live".
   - Status: Draft, Live, Live · edited, Paused.
   - Discard asks first.
4. Share: a link, three embed styles, a prefill link.
5. A visitor sends.
   - Required questions block sending.
   - Spam is kept separately, with "Not spam".
   - A paused form says it is closed.
   - "After they send" can count down into a booking page.
6. Submissions:
   - Open the person, Add to CRM, spam, delete with Undo, retry.
   - Sync earlier submissions after the mapping changes.

## 11. Link page
- Live since first run.
- Blocks:
  - The types: booking page, link (the title comes from the site), heading, writing, FAQ, testimonial, form, email signup.
  - Drag to reorder; archive with Undo; delete asks first.
- The visitor uses /<handle>. Team pages and QR codes.

## 12. ⌘K, search, shell
- **⌘K**: search records, notes and tasks; Recent; "Create person '<query>'"; actions.
- **Sidebar**: customise (hide, reorder, Reset); the rail with `[`.
- **Shortcuts**: `?` lists them; ⌘Z is global undo. Fully keyboard-operable.

## 13. Settings
- Account, Workspace, People, Scheduling, Business, Data, Developer (API keys, scope, revoke).
- Partner connect: an outside hub, sign up, pick a workspace, tick modules, Connect. Disconnect confirms.

## 14. Super admin
Operators only, read only and logged: Overview, Users, Booking pages, Website analytics, Partners.

## 15. Deleting and switching
- **Switching**: the workspace menu; the last workspace is remembered.
- **Delete workspace**: type the address; 30 days to Restore.
- **Delete account**:
  1. Lists blockers: workspaces where you are the last owner.
  2. Confirm with your email plus a step up. No grace window.

## Handoffs into Bookings and Business
- First-run booking page step.
- A form's countdown into a booking page.
- Link page booking blocks.
- Captures › Links; Settings › Scheduling.
- Booking notices in the inbox.
- Guest demotion and member removal pause pages.
