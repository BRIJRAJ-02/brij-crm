The inbox: what people did that needs you, newest first, with a bell that shows how many are unread.

**Use it for**: the Inbox page and the bell's popover in the top bar. **Don't** use it for a record's history (ActivityFeed) or for toasts.

**The consumer provides**: `items` (`actor`, `action`, `object`, `excerpt`, `time`, `group` Today or Earlier, `read`), `onOpen`, `onReadChange`, `onReadAll` and `onArchive` (called after the Undo window). `NotificationBell` takes the unread `count` and the popover content.

**States**: unread (blue dot, bold names), read, archived ("Archived · Undo" for 5 seconds), empty ("You're all caught up"), bell with and without a count.

**Interaction**: rows are a React Aria grid list: arrows move, Enter opens and marks read, E archives. Hover or focus shows Mark read and Archive in a small raised bar in place of the time. Mark all read fades every dot together. Archive folds the row into an Undo strip, then collapses it (250ms). The badge slides in from below left and pops with a bounce (notification badge, 500ms); it leaves in 150ms when the count reaches zero.

**Replaces**: NotificationList.
