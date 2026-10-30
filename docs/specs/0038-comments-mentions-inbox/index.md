# 0038. Comments, mentions and the inbox

**Date**: 2026-10-20
**Status**: Proposed
**Scope**: #29 Comments and mentions and #28 Notifications, Slice 7 ([Collaboration](../../scope/collaboration.md)); the roadmap's Release 1 line "Comments with @mentions, and an in app inbox" ([roadmap](../../plan/roadmap-2026-10-20.md))
**Numbering**: handed out by the coordinator on 20 October 2026. This spec owns AC-1151 to AC-1190.

## Owner decisions needed

The owner accepted every recommendation below on 21 October 2026; each is now a decision.

Each has a recommendation and a runner up. The build follows the recommendations unless the owner says otherwise.

1. **What a comment holds.** Recommended: plain text with mentions, stored as text in which a mention is a token naming the member by id (`<@member-uuid>`), so a rename never rewrites a comment; line breaks kept, links made clickable on display. Comments move to the shared rich text editor (spec 0019's `@crm/ui/editor`, comment mode) once notes land, converting each token into a mention node. Runner up: rich text through the notes editor now, which waits for the notes lane to land and puts Tiptap on the record page.
2. **Where comments live on a record.** Recommended: a Comments tab on the record page beside Overview, Activity and Tasks, its label carrying the count of open threads. Runner up: Attio's Details and Comments switch in the side column.
3. **Who may comment.** Recommended: anyone who may read the record may comment on it, reply, react and resolve; commenting never needs write access to its object. Runner up: commenting needs write on the record's object.
4. **Editing and deleting.** Recommended: authors edit their own comments at any time, and each edit keeps the text it replaced, shown as "edited" with the earlier versions in a popover; authors delete their own; owners and admins may delete anyone's (a new permission, `comments.manage`) but never edit it. A deleted comment that has replies stays as "This comment was deleted." so the thread still reads. Runner up: edits only in the first 15 minutes, and no one deletes another's comment.
5. **Resolving.** Recommended: anyone who may comment resolves and reopens a thread; resolved threads fold away under "Resolved threads (n)" at the end of the tab; a reply to a resolved thread reopens it. Runner up: only the thread's author resolves.
6. **Reactions.** Recommended: yes, a fixed set of six (👍 ❤️ 🎉 😄 👀 ✅), each a toggle per member with a count and the names in a tooltip; no notification for a reaction. Runner up: no reactions in the first version.
7. **Mentioning someone who can't see the record.** Recommended: the picker lists every active member; a mentioned member who can't read the record gets a notification that stays absent for them (hidden means absent) and appears if they gain access. Runner up: the picker lists only members who may read the record, which needs a per member access check for every keystroke.
8. **What notifies you.** Recommended: three kinds, never for your own actions: you were mentioned in a comment; someone replied in a thread you started or commented in; someone else assigned you a task (spec 0019). A comment that both mentions you and replies in your thread notifies you once, as a mention. "Records you follow" waits for a follow feature (Follow-up). Runner up: also notify every member who ever commented on the record about each new thread.
9. **The inbox.** Recommended: one row per notification, newest first, in two tabs, Inbox and Done; filters by kind (All, Mentions, Replies, Assignments) and "Unread only"; opening one marks it read and opens the comment or task where it lives; Mark done, Mark unread and Mark all as read; done ones are kept for 90 days, then removed by the daily cleanup. Runner up: Linear's split view, grouped by record, with the record shown beside the list.
10. **The sidebar count.** Recommended: unread notifications that aren't done, "99+" past 99, hidden at zero. Runner up: everything not done, read or not.
11. **Email.** Recommended: mentions and task assignments are emailed by default, but only when still unread 5 minutes later, and every notification gathered in those 5 minutes goes in one email; replies are not emailed by default; a daily digest of what is still unread is opt in (off by default), sent at 08:00 in the member's time zone, following the roadmap's "a digest is opt in". Runner up: an email at once for every mention.
12. **Whose settings.** Recommended: per member per workspace, under Settings › Account › Notifications (it shows the current workspace's), because the inbox is per workspace. Runner up: one setting per account across every workspace.
13. **How a notification arrives live.** Recommended: a new outbox kind, `notifications`, naming only the recipients' member ids, delivered to every audience on the workspace channel the way spec 0034's `nav` is; a client acts only on its own member id and reads its inbox through the access door. Runner up: a personal channel per member, which spec 0007 turned down.

## Summary

Members talk about a record where it lives. A record's Comments tab holds threads: a comment, its replies, reactions, edits with history, and a resolve state. Typing `@` in a comment opens a picker of members, and a mentioned member gets a notification. Notifications (mentions, replies in your threads, tasks assigned to you) land in a per workspace inbox at `/w/$slug/inbox`, live, within a second, with an unread count in the sidebar. Each member chooses which notifications reach them by email under Settings › Account › Notifications; email waits 5 minutes and batches, so nobody is flooded. Events carry ids only, so every screen loads comments and notifications through the access door, and nothing about a record a member can't read ever reaches their browser.

Reasoning and options: see [rationale.md](rationale.md).

## Dependencies

| Feature | What this spec needs | When it is missing |
|---|---|---|
| Spec 0017 record page | the page, its tabs and their counts | hard prerequisite (landed) |
| Spec 0019 tasks | `createTask`, `updateTask` and the task dialog, for assignment notifications; the notes editor (milestone 3) for rich text comments later | tasks have landed; comments stay plain text until the editor lands (decision 1) |
| Spec 0007 realtime, spec 0009 access | the outbox and relay, `filterEvent`, `readRecords` and `visibleRecords`, `enterAsActor` for the email task | hard prerequisite (landed) |
| Spec 0008 background jobs | the daily cleanup (a phase removes done notifications after 90 days) and Graphile's keyed tasks (the email task) | hard prerequisite (landed) |
| Spec 0022 trash | the purge removes a record's comments and notifications with it | landed |
| Spec 0026 settings area | Settings › Account, its navigation | landed |
| Spec 0031 members | the members list and invitations; the second member in flows comes from `member:add` until invites land | flows add the second member with `pnpm --filter @crm/core member:add` |
| Spec 0034 sidebar v2 | Inbox at the top of the sidebar with its badge (AC-924) | agreed with the sidebar lane on 21 October 2026: this spec owns the route (`/w/$slug/inbox`, the nav model's page key `inbox`), the screen and the data, and exposes `data.inbox.unread(workspace): UnreadSource`, read through `useInboxUnread(source): number \| undefined` in `@crm/data/react`, live through the `notifications` event; the sidebar lane adds the Inbox entry and shows that count as its badge, and this spec edits no sidebar file |

## Requirements

**User stories**:
- As a member, I want to comment on a record and reply in a thread, so the conversation about a deal stays with the deal.
- As a member, I want to @mention a teammate, so they know I need them.
- As a member, I want one inbox of what needs me (mentions, replies and tasks given to me), live, so I never miss a question.
- As a member, I want email only for what matters to me, without a flood.
- As a member, I want to fix a typo in my comment, and see when someone else changed theirs.

**Acceptance criteria** (this spec owns AC-1151 to AC-1190; AC-1151 to AC-1186 are used, the rest are spare):

*Comments*
- **AC-1151**: A record's Comments tab lists its open threads oldest first, each a first comment and its replies in order, with the composer for a new thread at the end. Each comment shows its author's avatar and name, when it was written ("2m", the full time in a tooltip) and its text, with mentions as the Mention atom naming the member's current name. The tab's label carries the open thread count. 20 threads load at first, the newest 20, and "Show earlier threads" loads 20 more.
- **AC-1152**: The composer is a text field that grows to 10 lines, with "Comment" (or ⌘Enter, Ctrl+Enter) to send and Esc to clear focus. A comment holds 1 to 10,000 characters after trimming its ends; the count shows past 9,000. Sending shows the comment at once, marked sending; a refusal puts the text back in the composer with the reason and a Retry.
- **AC-1153**: Each thread has "Reply", which opens a reply composer under its last comment; a reply joins the thread at once. A thread holds at most 500 comments; the 501st is refused with "This thread is full. Start a new one."
- **AC-1154**: Typing `@` at the start of the text or after a space opens the members picker under the composer: every active member, the matching ones first as you type (name and email), up to 8 shown, with avatar, name and email. Up and Down move, Enter or Tab picks, Esc closes; a pick puts "@Name" in the text, and the comment stores the member's id. Removing a character of "@Name" removes the whole mention. The text field is a combobox with `aria-activedescendant`, so a screen reader hears each option.
- **AC-1155**: An author edits their comment from its menu (Edit, or Up in an empty reply composer for their last one); Save stores it and marks it "edited"; Esc cancels. "edited" opens a popover listing earlier versions newest first with their times. Editing to an empty text is refused ("A comment can't be empty. Delete it instead.").
- **AC-1156**: An author deletes their comment from its menu after a confirm; an owner or admin (`comments.manage`) can delete anyone's the same way. A deleted comment leaves every screen, unless its thread has other live comments, where it reads "This comment was deleted." without its author or text. A thread whose comments are all deleted leaves the tab. A delete removes the notifications that comment made.
- **AC-1157**: Anyone who may comment resolves a thread from its first comment's menu ("Resolve thread") and reopens it the same way. A resolved thread folds into "Resolved threads (n)" at the end of the tab, a disclosure closed by default, and shows who resolved it and when. A reply to a resolved thread reopens it.
- **AC-1158**: Each comment has "Add reaction", a menu of 👍 ❤️ 🎉 😄 👀 ✅; a reaction shows as a chip with its count, pressed when it is mine (`aria-pressed`), and pressing it toggles mine. Its tooltip names who reacted ("Ada, Bea and 3 others"). A comment holds at most the six reactions per member.
- **AC-1159**: Every change to a record's comments (new, reply, edit, delete, resolve, reopen, reaction) shows in every other open browser that may read the record within 1 second, through a `comments` change event naming the record and the thread, never the text.
- **AC-1160**: A record in the trash keeps its comments hidden with it; restoring brings them back. Purging the record deletes its comments, their versions and reactions, and the notifications about them, explicitly in the purge's transaction.
- **AC-1161**: A link to a comment (`/w/$slug/objects/$object/$recordId/comments?thread=<id>`) opens the tab, unfolds the thread if resolved, loads earlier threads until it is shown, scrolls it into view and highlights it for 2 seconds; a thread that is gone or hidden shows "That comment isn't available." in the tab.
- **AC-1162**: The tab's states: loading (skeleton rows), empty ("No comments yet. Start the conversation." with the composer), error with Retry, and read only for a record in the trash (no composers, no menus). A member who can't read the record never reaches the tab (spec 0017's unavailable page).

*Notifications*
- **AC-1163**: A comment that mentions members notifies each of them once with kind `mention`, except its author and members already mentioned by an earlier version of the same comment. An edit that adds a mention notifies the new member; an edit that removes one removes that member's notification for it.
- **AC-1164**: A reply notifies with kind `reply` everyone who wrote a live comment in the thread before it, except its author and anyone the reply mentions (they get `mention`).
- **AC-1165**: A task created with, or changed to, an assignee other than the person making the change notifies the assignee with kind `task_assigned`; unassigning or reassigning removes the earlier assignee's unread notification for it. Ticking a task done notifies no one.
- **AC-1166**: A notification shows only while its recipient may read what it is about: the record (live, on an object they may read, inside their record rule) for comments, and the task (spec 0009's task rule) for assignments. Otherwise it is absent from the inbox, the count and email, and comes back if access returns. Nothing about it reaches their browser while absent.
- **AC-1167**: Writing a notification happens in the comment's or task's own transaction, with one `notifications` outbox row naming the recipients' member ids only; the recipient's open browsers show it within 1 second (the Release 1 bar: a mention arrives in a second browser within a second).
- **AC-1168**: Removing a member deletes their notifications and their notification settings (spec 0009's `removeMember` hook).

*The inbox*
- **AC-1169**: The inbox (`/w/$slug/inbox`, full width) lists my notifications newest first, 50 at a time as I scroll, in two tabs: Inbox (not done) and Done. Each row: the actor's avatar, a sentence ("Ada mentioned you", "Ada replied in a thread on Acme Corp", "Ada assigned you a task"), the record as a RecordChip when there is one, the comment's first 200 characters or the task's title, the time, and an unread dot. Unread rows read bolder.
- **AC-1170**: Filters: All, Mentions, Replies and Assignments (a segmented control), and an "Unread only" switch; both are kept in the address (`?kind=`, `?unread=1`) so a link and Back keep them.
- **AC-1171**: Pressing a row (or Enter on it) marks it read and opens what it is about: a comment's thread on its record (AC-1161), or a task's dialog (`?task=<id>` on the inbox itself). Each row's menu, and keys on the focused row, act on it: Mark as read or unread (`U`), Mark done or Move to inbox (`E`). "Mark all as read" in the bar marks every unread notification in the current tab and filter. Each change shows at once and rolls back with a toast on refusal.
- **AC-1172**: The inbox stays live: a new notification appears at the top within 1 second, and a change made in another tab or device (read, done) shows within 1 second.
- **AC-1173**: States: loading (skeleton rows), empty Inbox ("You're all caught up." with an icon), empty Done ("Nothing done yet."), empty under a filter ("No notifications match." with Clear filters), and error with Retry.
- **AC-1174**: The sidebar's Inbox item carries the unread count as a badge ("99+" past 99, none at zero), live within 1 second, read through one data layer source and hook (`data.inbox.unread(workspace)` and `useInboxUnread`) that sidebar v2 shows. The browser tab's title gains "(n)" while n is above zero.
- **AC-1175**: Done notifications are removed 90 days after they were marked done by the daily cleanup; unread and read ones stay until done.

*Email*
- **AC-1176**: When a notification is written for a member whose settings email that kind, an email task for the member and workspace is queued for 5 minutes later, keyed so a burst queues one task. When it runs it sends one email holding every notification of that member that is still unread, not done, not yet emailed and visible to them (entering as that member through `enterAsActor`), up to 20 listed and "and n more", each with a link to it; it marks them emailed. Nothing visible left means no email.
- **AC-1177**: Email is never sent to a member who was removed, and the email carries no text of a comment the member can't read at the moment it is sent. Its subject names the count and the workspace ("2 new notifications in Acme"); it links to the inbox; it carries one "Notification settings" link and no tracking.
- **AC-1178**: A member who turns on the daily digest gets, at 08:00 in the time zone their browser had when they turned it on, one email of their unread notifications not yet emailed, when there are any; the same rules as AC-1176 and AC-1177.

*Settings*
- **AC-1179**: Settings › Account › Notifications (`/w/$slug/settings/account/notifications`) shows, for the current workspace, a switch per kind for email (Mentions on, Replies off, Task assignments on by default) and the daily digest switch (off by default). Each switch saves at once and rolls back with a toast on refusal. The in app inbox is always on and says so.
- **AC-1180**: A member's settings reach their other open tabs within 1 second (the same `notifications` event naming them).

*Security and quality*
- **AC-1181**: Every comment and notification read and write passes the access door: commenting on a record the member can't read is `NOT_FOUND` with the record message; editing another's comment is `FORBIDDEN`; reading, marking or deleting another member's notifications is impossible (every procedure acts on the caller's own rows only, and a notification id that isn't theirs answers `NOT_FOUND`).
- **AC-1182**: The tables `comments`, `comment_versions`, `comment_reactions`, `notifications` and `notification_settings` force row level security with the standard policy, and the guard tests prove a cross workspace read returns nothing.
- **AC-1183**: Change events carry ids only: `comments` names the object, the records and the threads; `notifications` names member ids. A restricted audience under a record rule gets a coarse `comments` event with no ids.
- **AC-1184**: Every new screen meets WCAG AA in light and dark (axe clean), works fully by keyboard, and its components come from the library, with a README and a story per state for every new one.
- **AC-1185**: The inbox and Comments tab load lazily; the first load stays within its 250 kB budget.
- **AC-1186**: A Playwright flow with two browsers, two members of one workspace: A mentions B in a comment and B's sidebar count and inbox show it within 1 second; B opens it, lands on the thread, replies, and A's inbox shows the reply live.

## Decision

Comments are rows in their own tables beside the records engine, attached to any record by record id (never per object columns), written through `runWrite` so every change stores its outbox rows in its own transaction, and read through the access door with the record's visibility. Notifications are written in the same transactions by one small module that every source calls (`notify`), read only by their recipient, filtered through the door at read time, and delivered live by a `notifications` outbox kind that names members only. Email runs from the worker as one keyed Graphile task per member, entering as that member, so email can never show what the inbox wouldn't. See [rationale.md](rationale.md).

## Feature design

### Data model

All tenant tables: `workspace_id` first, forced row level security with the standard policy, audit columns where rows are edited (spec 0004), indexes leading with `workspace_id`.

**`comments`**
- `id` (UUID v7 the browser mints, the retry key), `record_id` (foreign key to records, no `on delete` action: the purge deletes comments first), `thread_id` (the first comment's id; equal to `id` on a first comment; foreign key to `comments` in the workspace), `body` text (1 to 10,000 characters, mentions as `<@uuid>`), `mention_member_ids` uuid[] (parsed from the body by the service, at most 50), `version` integer (1, then +1 per edit), `edited_at`, `resolved_at` and `resolved_by_*` (first comments only, checked), `deleted_at` and `deleted_by_*`, audit columns.
- Indexes: `comments_by_record (workspace_id, record_id, created_at, id) where id = thread_id and deleted_at is null` for the tab's pages; `comments_by_thread (workspace_id, thread_id, created_at, id)`.

**`comment_versions`**: `comment_id`, `version`, `body`, `created_at` (when that text was written), `created_by_*`; primary key `(workspace_id, comment_id, version)`; cascade with its comment. An edit inserts the text it replaces.

**`comment_reactions`**: `comment_id`, `member_id`, `emoji` (checked against the six), `created_at`; primary key `(workspace_id, comment_id, member_id, emoji)`; cascade with its comment and with its member.

**`notifications`**
- `id`, `member_id` (the recipient; cascade on member delete), `kind` (`mention`, `reply`, `task_assigned`), the actor (`actor_type`, `actor_id`, `actor_member_id`), `record_id` (nullable; no foreign key action, the purge deletes first), `thread_id`, `comment_id`, `task_id` (each nullable), `created_at`, `read_at`, `done_at`, `emailed_at`.
- One notification per recipient per comment (`unique (workspace_id, member_id, comment_id)` where `comment_id` is not null) and per task assignment (`unique (workspace_id, member_id, task_id) where kind = 'task_assigned'`).
- Indexes: `notifications_inbox (workspace_id, member_id, created_at desc, id desc) where done_at is null`, `notifications_done (workspace_id, member_id, done_at desc, id desc) where done_at is not null`, `notifications_unread (workspace_id, member_id, created_at desc) where read_at is null and done_at is null`, `notifications_unemailed (workspace_id, member_id) where emailed_at is null and read_at is null and done_at is null`.

**`notification_settings`**: primary key `(workspace_id, member_id)` (cascade on member delete), `email_mentions` (true), `email_replies` (false), `email_assignments` (true), `digest` (false), `time_zone` (an IANA name, required when `digest`), `digest_sent_on` date, `updated_at`, `version`. No row means the defaults.

The outbox gains two kinds, `comments` (object id, record ids, thread ids in `item_ids`) and `notifications` (member ids in `item_ids`).

### Services

`packages/core/src/comments/` (new):
- `listThreads(scope, { recordId, cursor?, resolved? })`: the record's visibility first (`NOT_FOUND` when hidden or trashed), then up to 20 threads (open, or resolved for the disclosure) newest first by their first comment, each with its comments (deleted ones as placeholders while others are live), reactions summarised `{ emoji, count, mine, memberIds (first 10) }`, `canEdit` and `canDelete` per comment. `openCount` on the first page.
- `getThreads(scope, { threadIds })`: the threads by id, the same shape, leaving out hidden and missing ones (what a `comments` event's ids are read back through).
- `createComment(scope, { id, recordId, threadId?, body })`: checks the record, parses mentions (only active members of the workspace count; others stay as plain text), inserts, reopens a resolved thread on a reply, writes notifications through `notify`, records `comments` in the `Change`.
- `updateComment`, `deleteComment`, `setThreadResolved`, `toggleReaction`: under the comment's row lock; the rules in the AC.
- `commentVersions(scope, { commentId })`: the earlier texts for the popover.

`packages/core/src/notifications/` (new):
- `notify(context, input)`: inserts notifications for a source (a comment, or a task assignment), skips the actor, de-duplicates by the unique keys, removes ones a source withdrew, records the recipients in `Change.notifications`, and queues the email task for recipients whose settings email that kind (`crm_enqueue_notification_email`, a definer function, as calendar sync's).
- `listNotifications(scope, { status: 'inbox' | 'done', kind?, unreadOnly?, cursor? })`: the caller's own rows only, 50 a page, each resolved through the door (`readRecords` with the caller's access for the record's display, `getTasks` rules for a task), the absent ones skipped (a page reads ahead up to 3 times to fill itself).
- `countUnread(scope)`: up to 100 unread rows read newest first and filtered the same way; answers `{ count, atLeast }`.
- `markNotifications(scope, { ids, read?, done? })`, `markAllRead(scope, { status, kind? })`.
- `getNotificationSettings`, `setNotificationSettings`.
- `sendNotificationEmail(deps, { workspaceId, memberId, mode: 'batch' | 'digest' })` in `@crm/core/system`: enters as the member (`enterAsActor`), reads through `listNotifications`, renders, sends through the mailer it is handed, marks `emailed_at`.

### API surface

| Procedure | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|
| `comments.list` | `recordId`, `cursor?`, `resolved?` | `{ threads, nextCursor?, openCount? }` | member, record readable | `NOT_FOUND` |
| `comments.get` | `threadIds` (≤ 50) | `threads` | member | none (absent ones left out) |
| `comments.create` | `id`, `recordId`, `threadId?`, `body`, `mutationId?` | the thread | member, record readable | `NOT_FOUND`, `INPUT_INVALID`, `LIMIT_REACHED`, `ID_TAKEN` |
| `comments.update` | `commentId`, `body`, `mutationId?` | the thread | author | `NOT_FOUND`, `FORBIDDEN`, `INPUT_INVALID` |
| `comments.delete` | `commentId`, `mutationId?` | `{ threadId }` | author, or `comments.manage` | `NOT_FOUND`, `FORBIDDEN` |
| `comments.resolve` | `threadId`, `resolved`, `mutationId?` | the thread | member, record readable | `NOT_FOUND` |
| `comments.react` | `commentId`, `emoji`, `on`, `mutationId?` | the thread | member, record readable | `NOT_FOUND`, `INPUT_INVALID` |
| `comments.versions` | `commentId` | `[{ version, body, at }]` | record readable | `NOT_FOUND` |
| `notifications.list` | `status`, `kind?`, `unreadOnly?`, `cursor?` | `{ items, nextCursor? }` | the caller's own | `INPUT_INVALID` (cursor) |
| `notifications.count` | none | `{ count, atLeast }` | the caller's own | none |
| `notifications.mark` | `ids` (≤ 100), `read?`, `done?`, `mutationId?` | `{ changed }` | the caller's own | `NOT_FOUND` |
| `notifications.markAllRead` | `status`, `kind?`, `mutationId?` | `{ changed }` | the caller's own | none |
| `notifications.settings` / `notifications.setSettings` | the switches, `timeZone` | the settings | the caller's own | `INPUT_INVALID` |

### Client (`packages/data`)

- `data.comments`, loaded lazily with the tab: a store per workspace and record holding the record's thread pages (`threads(workspace, recordId)`), optimistic create, reply, edit, delete, resolve and react (applied at once, rolled back with the reason), the live handler for `comments` (rereads the named threads through `comments.get`, a coarse event rereads every held record's first page, spread 0 to 2 s), and `useComments` in `@crm/data/react`.
- `data.inbox`, lazy too except for its count: the count lives in a tiny first load store (`inbox.unread(workspace)`, an `UnreadSource`, read with `useInboxUnread(source)`, which answers `number | undefined`: undefined until the first read, 100 standing for "99+"), read when the workspace frame mounts and again on each `notifications` event naming me (coalesced to one read per 250 ms) and on resync; the list store (`inbox.list(workspace, { status, kind, unreadOnly })`) pages by cursor and patches marks optimistically. The workspace frame watches its workspace while the count shows, so the count is live on every page.
- `data.notificationSettings` with optimistic switches.

### Realtime

- `comments`: `{ objectId, recordIds, threadIds }`. `filterEvent` cuts it as `notes`: none when the audience can't read the object; coarse with no ids under a record rule.
- `notifications`: `{ memberIds }`. Passed to every audience unchanged, like `members` and `nav`: it names member ids and no content. The data layer acts only on the signed in member's id.
- Catch up merges both by their id lists.

### Screens and library work

- `CommentThread` (module, new): a thread's comments with avatar, author, time, text with mentions, "edited", reactions, a per comment menu, Reply and the resolved state; every state storied.
- `CommentComposer` (molecule, new): the growing text field with the mention picker (a combobox listbox in a Popover), the count past 9,000, Send, and a sending state.
- `NotificationList` (module, new, the inventory's NotificationInbox): rows with actor, sentence, record chip, excerpt, time, unread dot and a row menu; keyed rows; every state storied.
- Settings › Account › Notifications is built from SettingsLayout, Card and Switch rows (no new component).
- Reused: Mention, Avatar, RecordChip, RelativeTime, Menu, Popover, Tooltip, Tabs, SegmentedControl, Switch, EmptyState, Skeleton, Disclosure, Badge.

### Value sourcing

| Display | Source |
|---|---|
| A comment's author, a notification's actor | the members list (`members.list`, cached), "Former member" for one removed |
| A mention's name | the members list at render time, by the id in the token |
| A notification's record | `readRecords` with the recipient's access, display only |
| A task notification's title | the task as `getTasks` reads it for the recipient |
| Unread count | `notifications.count` |

### Key invariants

- No comment or notification names a record or task its reader can't read, in any answer, event or email.
- One write is one transaction: the comment or task change, its versions, its notifications and its outbox rows.
- A member only ever reads and changes their own notifications and settings.
- Mentions are stored by member id; names are never stored in the text.

### Security model

The door produces every scope; comments inherit the record's read rule (decision 3), edits are author only, deletes author or `comments.manage`. Notifications procedures take no member id: the caller's own is the only one. The email task enters as the recipient, so a member who lost access or was removed gets nothing. Mention parsing accepts only `<@uuid>` tokens naming active members of the workspace. Emails escape every comment text and carry no tracking.

### Configuration required

None new: the worker gains the mailer the api already has (`RESEND_API_KEY` or `MAILPIT_URL`, `MAIL_FROM`) and `APP_URL` for links.

### Critical test scenarios

- Happy path: A mentions B; B's inbox and count show it live; B replies; A gets a reply notification. Verifies AC-1151, AC-1154, AC-1163, AC-1164, AC-1167, AC-1169, AC-1174, AC-1186.
- Access: B mentioned on a record whose object B can't read: B's list, count and email have nothing; access granted: it appears. Verifies AC-1166, AC-1177.
- Edits: removing a mention removes the notification; history lists the earlier text. Verifies AC-1155, AC-1163.
- Delete with replies leaves a placeholder; delete of the last comment removes the thread. Verifies AC-1156.
- Tasks: assigning B notifies B once; reassigning to C removes B's unread one. Verifies AC-1165.
- Guards: all five tables force row level security; a cross workspace read returns nothing; another member's notification id answers `NOT_FOUND`. Verifies AC-1181, AC-1182.
- Email: three mentions within 5 minutes make one email; a read one is left out; settings off sends nothing. Verifies AC-1176, AC-1179.

## Build plan

**Milestone 1: comments and mentions, end to end**
1. Migration: the five tables, two outbox kinds, guards; `comments.manage`; purge and `removeMember` steps. AC-1160, AC-1168, AC-1182.
2. Contracts and core: comments and notifications services, `notify`, the `comments` and `notifications` events and their filter rules. AC-1151 to AC-1159, AC-1163, AC-1164, AC-1166, AC-1167, AC-1181, AC-1183.
3. API procedures and the writes test. AC-1181.
4. Data layer: comments store, inbox count and list stores, live handlers. AC-1159, AC-1172, AC-1174.
5. Library: CommentComposer, CommentThread, NotificationList with stories. AC-1184.
6. Screens: the Comments tab and the inbox page (the sidebar lane adds the Inbox entry and its badge). AC-1151 to AC-1162, AC-1169 to AC-1174, AC-1185.

**Milestone 2: tasks and the two browser flow**
7. Task assignment notifications in `createTask` and `updateTask`. AC-1165.
8. The Playwright flow. AC-1186.

**Milestone 3: email and settings**
9. Settings › Account › Notifications. AC-1179, AC-1180.
10. The email task, its enqueue function and the worker's mailer. AC-1176, AC-1177.

**Milestone 4: digest and retention**
11. The digest's hourly task and the daily cleanup phase for done notifications. AC-1175, AC-1178.

## Consequences

**Positive**:
- One notification module every later source calls (record follows, automations, reminders), with access applied once at read time.
- Live delivery reuses the workspace channel; no per member channel, no polling.
- Plain text comments ship without waiting for the editor, and convert cleanly later.

**Negative / tradeoffs**:
- Filtering at read time means an inbox page may read ahead to fill itself when many notifications are hidden.
- Every member's clients receive every `notifications` event and drop most of them: one tiny message per notifying write.
- No rich text in comments until the notes editor lands.

**Neutral**:
- Comments don't appear in a record's Activity timeline in this version (Follow-up).

## Follow-up

- [ ] Rich text comments through the notes editor, converting mention tokens (decision 1).
- [ ] Comments on a passage of a note (scope #29), with the notes editor.
- [ ] Following a record, and notifications for changes to records you follow (scope #28).
- [ ] Comments in the record's Activity timeline.
- [ ] Warn in the composer when a mentioned member can't read the record.
- [ ] Snooze, as Linear has.

## Calls made fixing late traps, 27 to 30 October 2026 (shipped, main 82fbc760f)

A late trap is a change that saves fine, then breaks something later somewhere else, without anyone being told. Each line says what the product does now, and the trap it closes (numbers from the late trap audit). The owner asked for each to follow industry practice and delegated the product calls.

- Settings shows Email mentions off while the email's one click unsubscribe has the topic off, and turning it on there subscribes again (`updated_via = app`) (#87). A notifications email that was claimed but not sent is given back for the retry (#4).

## Calls made fixing late traps, round 2, 30 October 2026 (shipped, main 1cdb46072)

The same rules as the section above: each line says what the product does now, and the trap it closes.

- A new kind, `form_submission` (spec 0023): one per member and submission (`notifications.submission_id`, unique, migration 0130), from the system, with the form as its actor (a square gray tile with a clipboard mark). It reads "<form> got a new submission", opens the submission, and shows only while the member can see the form (hidden means absent). The Inbox filter has "Form submissions". It is never emailed in the 5 minute batch: its own email is the form's submission email, so the row is stored as emailed, except for a member with the digest on, whose submissions wait for the digest instead. Turning the digest off sends what was waiting. Deleting the submission or its form deletes the notice and tells the inbox.
