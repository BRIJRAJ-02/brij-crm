A conversation on a record, with mentions, icon reactions and replies, and the composer that writes into it.

**Use it for**: comments on records, meetings, form responses and notes. **Don't** use it for an AI conversation (AIAssist) or for system events (ActivityFeed).

**The consumer provides**: `comments` oldest first (`author`, `time`, `body`, `replyTo`, `reactions` by kind), `me`, `people` who can be mentioned, `onReact`, `onSend` (a promise; the composer shows sending until it settles) and `freshIds`. `CommentComposer` and `MentionText` are exported on their own.

With `onEdit`, `onDelete` and `onCopyLink`, the hover bar also has Copy link, and on your own comments Edit (the text becomes a field with Save and Cancel; ⌘↵ saves, Esc cancels) and Delete (the consumer asks first). A comment with `history` reads "edited" after its time; pressing it lists the earlier wordings. Resolved threads fold under "Resolved threads (n)".

**States**: empty, comments, my reaction (accent-soft pill), replying (a "Replying to" line with a cancel), sending (composer dims, spinner in Send), mention list open.

**Interaction**: hovering or focusing a comment shows Agree, Done, Seen and Reply in a small raised bar. Reactions are icons with counts that roll, never emoji. In the composer, @ opens the people list under it (menu dropdown motion); arrows move, Enter or Tab picks, Esc dismisses, and focus stays in the text. ⌘↵ sends; the new comment drops in at the foot.

**Replaces**: CommentThread, CommentComposer.
