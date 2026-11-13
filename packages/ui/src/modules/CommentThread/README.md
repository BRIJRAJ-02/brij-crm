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

## Timefix prototype (spec 0072)

Takes its look from the prototype's CommentThread. Each comment is the prototype's row: the avatar and the text `space-12` apart, padded `space-8` with `radius-md` corners, washing `surface-hover` under a pointer or with focus inside; the name in `text-body-strong`, its time in `text-caption` and `text-tertiary`, the text in `text-body` with its line breaks, reaction chips `space-4` apart under it. Its Add reaction and More actions float in the prototype's hover bar at the comment's top right (`surface-raised`, `radius-full`, padded `space-2`, `shadow-sm` with a `border-subtle` ring), fading in and rising `distance-micro` over `duration-quick` under a pointer or with focus inside (reduced motion keeps the fade and drops the rise); on touch the bar sits at the head's end, always shown. An earlier version reads in `text-body-sm-tight`, `text-secondary`. The thread sits on Card's surface (`surface`, a `border-subtle` hairline, `radius-lg`, padded `space-8`), since a screen lists several threads; the prototype draws one conversation with no frame.

**Use it for** comments on records, meetings, form responses and notes. **Don't use it for** system events (ActivityFeed) or an AI conversation.

**The consumer provides** `thread`, `members` and `formerMember`, `onReply`, `onEdit`, `onDelete` (the screen confirms), `onResolve`, `onReact`, `onLoadVersions` and `onShowEarlier`.

**States**: comments (`Default`), my reaction (the chip pressed, `Default`), replying (`Replying`), sending (`DeletedAndSending`), editing (`Editing`), edited (`EditedVersions`), resolved (`Resolved`), highlighted, read only, earlier replies; the mention list is CommentComposer's (`Mentioning`).

**Interaction**: hovering or focusing a comment shows its actions (`ActionsOnFocus`: Tab reaches Add reaction, then More actions, inside the comment).

**Differences from the prototype**
- One thread per part (the prototype's `comments` list is the screen's list of threads); resolved threads say who resolved them over the comments instead of folding under "Resolved threads (n)", and are not faded (the prototype's 72% opacity fails AA contrast).
- Reactions are the six emoji of `COMMENT_EMOJI` through an Add reaction menu, drawn as Button's ToggleButton chips (its pill, `accent-soft` with the `accent-text` edge when it is the reader's); the prototype's three icon reactions, their rolling counts and the bar's one press per reaction are not drawn.
- The bar holds Add reaction and More actions (Edit, Resolve, Delete); the prototype's bar holds every action as its own icon button, with Reply on R. Reply is the button under the thread.
- The avatar is Avatar's `sm` (the prototype's is `size-avatar`, 28); "edited" is a ghost Button, not the prototype's underlined word.
- The bar keeps taking the pointer while faded (the prototype sets `pointer-events: none`): it lies inside the comment, so a pointer over it shows it.
- Kept beyond it: deleted comments, sending, `isHighlighted`, `isReadOnly`, earlier replies, links made safe through `safeHref`, versions loaded on open.
