TeamList shows the workspace's people: who they are, their role, whether they joined, when they were last in, and what you can do to them.

**Use it for**: Settings › Members. **Don't use it for**: who is free today (use MeetingList or a presence list) or picking people (use MultiSelect).

**The consumer provides**: `members` (name, email, role, `active` or `invited`, `seen`, `isYou`), `now`, `workspace` (named in the remove question), `roles`, `onRoleChange`, `onResend`, `onRemove`, `onCopyEmail`, `action` (an Invite people button that opens InviteRows in a Dialog), `canManage`.

**States**: rows, searching, no matches (NoResults with Clear), read only, a changed row, a removed row. Owner and your own row are locked.

**Interaction**: search filters as you type and its clear dissolves the text. Each row has a role Select and a menu (Resend invite, Change role as a submenu, Copy email, Remove last in red); the menu trigger stays pressed while open. Remove and Cancel invite ask first in a ConfirmDialog, then the row collapses in place over 250ms. A changed role or a resent invite washes the row with `accent-soft` for a second, and the last-seen cell crossfades to "Invite sent" (04). Below 640px last seen leaves, below 480px the status tag too.

**Replaces**: TeamList.
