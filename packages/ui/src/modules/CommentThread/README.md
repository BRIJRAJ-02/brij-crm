# CommentThread

One thread of comments on a record: its first comment and replies, reactions, edits with history, the resolved state, and Reply.

## Why it exists

New (spec 0038, the inventory's CommentThread). Nothing in the library shows a conversation: ActivityFeed lists events, NoteList documents. It composes atoms and molecules that exist: Avatar, RelativeTime, Mention, Link, ToggleButton (a reaction chip, pressed when it is the reader's), Tooltip (who reacted), Menu (the comment's actions and the six reactions), Popover (earlier versions) and CommentComposer (reply and edit).

## Use

```tsx
<CommentThread
  thread={thread}
  members={members}
  formerMember="Former member"
  onReply={(body) => reply(thread.id, body)}
  onEdit={(id, body) => edit(id, body)}
  onDelete={(id) => askToDelete(id)}
  onResolve={(resolved) => resolve(thread.id, resolved)}
  onReact={(id, emoji, on) => react(id, emoji, on)}
  onLoadVersions={(id) => versions(id)}
  onShowEarlier={() => wholeThread(thread.id)}
/>
```

- A comment's `body` holds mentions as `<@member-uuid>` tokens; each draws as the Mention atom with the member's current name, or `formerMember`. Links in the text are made clickable (through `safeHref`) and line breaks are kept.
- A deleted comment (`isDeleted`) reads "This comment was deleted." with no author or text, while its thread still has other live comments.
- `isSending` shows "Sending" in place of its time (and `aria-busy` on the row); it isn't faded, so its text keeps its contrast.
- Delete is only asked for: the screen confirms it in a danger Modal (a delete has no Undo).
- `isReadOnly` (a record in the trash) hides Reply, the menus and the reaction buttons; the chips still show.
- `isHighlighted` gives the thread the accent's soft fill and scrolls it into view (a jump under reduced motion), for a thread opened from a link.

## States

Open, resolved (the resolved line and Reopen in the first comment's menu), with reactions, edited (its popover loading, loaded or failed), with a deleted comment, sending, replying, editing, with earlier replies left out, highlighted, and read only.

## Keyboard

Every action is a button: Reply, Add reaction (a menu of the six), More actions (Edit, Resolve or Reopen on the first comment, Delete), each reaction chip (Space toggles it), and "edited" (opens the earlier versions). The composer's keys are CommentComposer's.

## Differences from the artifact

The artifact has no CommentThread yet; this is code first, published with the next `pnpm ui:artifact`.
