# 0038. Comments, mentions and the inbox: rationale

## Context

The record page (spec 0017) has Overview, Activity and Tasks; notes and My tasks are being built in another lane (spec 0019 milestones 2 to 4), including a Tiptap editor with a mention node in `@crm/ui/editor`, not yet landed. Members exist with roles (spec 0009); invites arrive with spec 0031. The roadmap's Release 1 is done when, among other things, "the mention arrives in a second browser within a second". The sidebar v2 lane (spec 0034) places Inbox at the top and waits for #28 for its count.

Forces: the data model rule that notes, tasks, comments and files attach to any record by record id; one client data layer with optimistic writes (spec 0006); change events with ids only, delivered on audience channels, with a per member channel already turned down (spec 0007); hidden means absent, including notifications (spec 0009); the 250 kB first load; WCAG AA; email that never floods.

## Options considered

### Option 1: comments in their own tables, notifications written in the same transaction, filtered at read time, live by a members only event (chosen)

**Pros**: the comment, its notifications and their events commit or fail together; access applies once, at read, so a change of rules needs no rewrite of stored notifications; the live path reuses the workspace channel.
**Cons**: an inbox page may read ahead past hidden rows; every client receives every notification event and drops most.

### Option 2: comments as records of a hidden "Comment" object

**Pros**: history, events and access for free from the engine.
**Cons**: a comment isn't a record a person sees in tables, filters or imports; it would leak into every generic path (search, exports, limits) and need exceptions everywhere.

### Option 3: notifications fanned out by a job reading the outbox

**Pros**: writes stay smaller; one consumer for every source.
**Cons**: adds a hop (relay, then job, then another event) that makes the one second bar hard; a crash between the two leaves a mention with no notification; harder to remove a notification when its mention is edited away.

### Option 4: a personal Centrifugo channel per member for notifications

**Pros**: a client receives only its own events.
**Cons**: spec 0007 turned it down (a token and subscription per member per tab, more state on one node); the content saved is tiny, since the event names member ids only.

## Rationale

Option 1 meets the one second bar with the least machinery: the write that makes a mention also makes the notification and its outbox row, the relay publishes it like any other kind, and the recipient's tab reads its count and list through the door. Filtering at read time is what makes "notifications respect access" true over time, as rules and trash change; storing only ids means nothing needs rewriting when they do.

Calls made without a question, each with its runner up:
- Mentions stored as `<@uuid>` tokens in plain text (runner up: a separate mentions table and offsets), so the text alone round trips into the editor's mention nodes later, and a rename never touches comments.
- Threads ordered oldest first with the composer at the end (runner up: newest first), as Attio, Linear and Notion read: a conversation reads down.
- One notification per recipient per comment (runner up: one per reason), so a reply that mentions you doesn't ring twice.
- The count reads at most 100 unread rows (runner up: an exact count over every row), since the badge shows "99+" past 99 and the read stays bounded at a million records.
- Email keyed per member and workspace with Graphile's `preserve_run_at` (runner up: a sweep every minute), so a burst of mentions is one waiting row and one email.
- The email task enters as the recipient through `enterAsActor` (runner up: a system read with its own filter), so email can never show what the inbox wouldn't.
- Settings stored per member per workspace with no row meaning the defaults (runner up: a row for every member at join), so nothing is written until someone changes a switch.
- A `comments.manage` permission for owners and admins (runner up: reuse `workspace.manage`), because roles are flat lists and a moderation power should be named for what it does.

## Evidence

- **Attio** (Mobbin, web): the record page's side column has Details and Comments tabs, Comments with a count; Notifications sits at the top of the sidebar. The model for comments living on the record and for the inbox's place.
- **Linear** (Mobbin, web): the Inbox lists notifications with an unread dot, a sentence and a time, opening the issue beside it; Snooze and delete with Undo. Settings › Notifications › Email: email on or off, a digest format, and switches per category (Assignments, Comments and replies, Mentions, Reactions). The model for the inbox rows and the settings page; the split view is the runner up to decision 9.
- **Notion** (Mobbin, web): comment cards with avatar, name, time and text, a "Reply…" composer with @ and an emoji reaction picker; the @ picker lists users by name and email. The model for the thread and the mention picker.

## References

**Project sources**: spec 0003 inventory (CommentThread, CommentComposer, NotificationInbox, NotificationPreferences, the Mention atom), spec 0007 (the outbox, audience channels, no per member channel), spec 0008 (Graphile tasks, the daily cleanup), spec 0009 (the door, `enterAsActor`, `removeMember`), spec 0017 (record tabs), spec 0019 (tasks, the notes editor), spec 0022 (the purge), spec 0026 (Settings › Account), spec 0034 (Inbox in sidebar v2, the `nav` event this one copies), `docs/scope/collaboration.md`, `docs/plan/roadmap-2026-10-20.md`.
