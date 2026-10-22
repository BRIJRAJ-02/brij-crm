# Inbox

Spec 0038: the person's notifications in a workspace. The sidebar's Inbox item and its badge belong to the sidebar (spec 0034), which reads the same `data.inbox.unread(workspace)` and `useInboxUnread`.

## The inbox (InboxScreen, `/w/$slug/inbox`)

- **Purpose**: everything that needs the person here: mentions, replies in their threads, tasks given to them.
- **Main task**: open each new one where it lives, and clear the inbox as they go.
- **Leaves out**: email and digest settings (Settings › Account › Notifications), other people's notifications, search.

## Notes

- Inbox or Done, the kind (All, Mentions, Replies, Assignments) and Unread only live in the address (`?status=done`, `?kind=`, `?unread=1`), so a link and Back keep them. Inbox or Done is a segmented control, the kind a small Select ("All kinds" with Mentions, Replies and Assignments), and Unread only a switch, in the page bar. The kind was a second segmented control until 22 October 2026: four segments beside Inbox and Done ran off a phone's width, and two segmented controls side by side read as one control.
- The list is `data.inbox.list` (its store loads in its own chunk), 50 at a time as it scrolls, live through the `notifications` event naming the person.
- Pressing a row (or Enter) marks it read and opens its comment's thread on the record's Comments tab (`?thread=`), or an assignment's task dialog over the inbox (`?task=`). The row's menu and its keys (`U`, `E`) mark it; "Mark all as read" marks the tab and kind shown.
- `UnreadTitle` (mounted by the workspace route) keeps the unread count on the root element's `data-unread`, and the title follows it: "(3) People · Timefix".
- Every string is in `strings.ts`.
