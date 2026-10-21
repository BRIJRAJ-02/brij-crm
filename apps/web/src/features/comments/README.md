# Comments

Spec 0038: comments on a record, with mentions. The inbox they feed is `features/inbox`.

## A record's Comments tab (CommentsTab)

- **Purpose**: the team's conversation about this record.
- **Main task**: start a thread or reply in one, mention a member with `@`, and resolve it when it's settled.
- **Leaves out**: mentions in notes (round 4), attachments, comments on one field.

## Notes

- The tab reads `data.comments.forRecord` (the store loads in its own chunk); the route's loader starts it with the page, so the tab's label carries the open thread count (`useCommentCount`) on every tab.
- Open threads show oldest first, "Show earlier threads" above them, then the composer for a new thread, then "Resolved threads (n)" folded (loaded as it opens).
- Every write (comment, reply, edit, resolve, react, delete) goes through the data layer at once and is put back with a toast on a refusal; a refused comment or edit also comes back in its composer with the reason and Retry.
- Delete asks first in a danger Modal (a delete has no Undo).
- `?thread=<id>` (AC-1161) loads until the thread is held, unfolds the resolved ones when it is there, scrolls to it and lights it for two seconds; a thread that is gone or hidden says "That comment isn't available." in the tab.
- A record in the trash shows its threads read only: no composers, menus or reaction buttons.
- Every string is in `strings.ts`.
