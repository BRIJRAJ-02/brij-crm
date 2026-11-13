# NotificationList

The inbox's rows: who did what (or which form got a new submission), on which record, the comment's start or the task's title, when, and whether it is read.

## Why it exists

New (spec 0038, the inventory's NotificationInbox). No list in the library marks rows read or done: NoteList's rows open a document, TaskList's tick a task. It follows NoteList's patterns (a React Aria `GridList`, virtualised, fed by a `ListSource`, rows keyed by item) and draws with existing atoms: Avatar, RecordChip, RelativeTime, a Menu, and CommentThread's `CommentText` for the excerpt, so a mention in it reads by name as it does in the thread.

## Use

```tsx
<NotificationList
  label="Inbox"
  items={source}
  members={members}
  formerMember="Former member"
  onAction={(id) => open(id)}
  onMark={(id, mark) => markIt(id, mark)}
  status={status}
  onRetry={retry}
  emptyTitle="No notifications match."
  emptyActions={<Button onPress={clear}>Clear filters</Button>}
/>
```

- An item is `{ id, kind, actor, createdAt, isRead, isDone, record?, isNote?, formName?, pageTitle?, excerpt }`; the sentence comes from the kind ("Ada Lovelace mentioned you", "replied in a thread", "assigned you a task", and the system's "Your task is due today" on a task's due day, which names nobody), and a form's new submission (`form_submission`, spec 0023) is named by its form instead of its actor: "Contact us got a new submission", with the record it filed as the chip and no excerpt. A scheduling change someone else made (`scheduling_changed`, spec 0037) reads "Grace Hopper changed your scheduling", with no chip or excerpt. A webhook endpoint turned off after three days of failed deliveries (`webhook_off`, spec 0064) leads with the endpoint rather than an actor, since nobody turned it off: "hooks.example.com stopped answering, so its webhook is off", the host coming in as the excerpt, with the system's mark as its avatar and no chip. A guest's booking on one of the reader's pages (`booking`, B-12) reads "Ada Lovelace booked Intro call" from the item's `pageTitle` (the guest is the actor, under the booking's mark), with the guest's person as the chip when the reader may see it and when it starts as the excerpt, which the screen writes on the member's clock. An actor that isn't a member (a form, the system) shows its mark from RecordChip's `ACTOR_ICONS` on Avatar's soft gray square, not initials, so it never reads as a person.
- Unread rows show the accent dot and a bolder sentence, and read "Unread" first to a screen reader. Marked read, the dot fades and shrinks away.
- The order is the screen's (newest first). A row still loading draws a skeleton and tells the source it is on screen, which loads the next 50.

- `isNote` on a mention says it was in a note ("Ada mentioned you in a note"); its excerpt is the note's title.

## States

Unread, read, done, loading (skeleton rows), empty (in the screen's words, with its actions, and no line under the title: an empty inbox says "You’re all caught up" and nothing more), failed with Try again, and no access.

## Keyboard

The arrows move between rows, Enter opens one; the right arrow reaches the row's menu. On a focused row, U marks it read or unread and E marks it done or moves it back to the inbox; the row's menu shows both with their keys.

## Differences from the artifact

The artifact has no inbox yet; this is code first, published with the next `pnpm ui:artifact`.

## Timefix prototype (spec 0072)

Takes its look from the prototype's inbox rows: `space-8` of room (`space-6` before the dot) at `radius-md`, `space-12` between the dot, the avatar, the text and the menu. The unread dot is `accent`, `space-8` round, level with the first line; read, it fades and shrinks to `scale-shrunk` over `duration-fast` on `ease-smooth-out`, so marking several read lets their dots go together. The sentence is `text-body` (`text-body-strong` while unread), the time `text-caption` in `text-tertiary` with tabular figures. A row washes `surface-hover` under a pointer and `surface-selected` when pressed (`duration-quick`, `ease-out`), and the keyboard's row takes the outline ring just inside it, since the list clips. With a pointer, the row's menu shows only while the row is hovered or holds focus, or its menu is open (the prototype's actions bar, in CSS); under a finger it always shows. Reduced motion keeps the dot's fade and drops its shrink.

**Use it for** the Inbox page and the bell's popover. **Don't use it for** a record's history (ActivityFeed) or for toasts.

**The consumer provides** `items` (a `ListSource` of `NotificationItem`), `members` and `formerMember` for the excerpt's mentions, `onAction` (open it, and mark it read), `onMark(id, { read?, done? })`, `status` with `onRetry`, and the empty words and actions. The bell, its count and the Today and Earlier headings are the screen's.

**States**: unread (dot, bolder sentence), read, done, hover (the menu shows), pressed, keyboard focus, loading, rows still loading, empty ("You’re all caught up."), no matches, failed, no access.

**Interaction**: Enter or a click opens a row; the arrows move between rows; U marks read or unread and E done or back to the inbox, also from the row's menu; marking read fades the dot.

**Differences from the prototype**
- The row's actions stay one menu ("More actions": Mark as read, Mark done, with their keys), not the prototype's raised bar of Mark read, Snooze and Archive buttons over the time; the time stays where it is. Snooze (`onSnooze`, `snoozeTimes`) is not in the library.
- Archive is the library's Mark done through `onMark`, with no "Archived · Undo" strip and fold: the screen offers Undo (owed to the inbox screen phase if it wants the strip).
- The avatar stays `sm` (20px), not the prototype's 28 (`md`): a prop value in the TSX, left for the lead.
- The excerpt keeps CommentText's quiet line (`text-body` in `text-secondary`, one line, mentions by name), which CommentThread owns; the prototype's is `text-body-sm-tight` in `text-tertiary`.
- No head (title, unread count, Mark all read), no Today and Earlier headings, no `NotificationBell`: the inbox screen draws those.
- Kept beyond the prototype: `ListSource` paging with skeleton rows, `status`, the many `kind`s with their sentences (forms, bookings, webhooks, scheduling, the system's marks), the record chip, done as well as read, U and E keys, `emptyTitle` and `emptyActions`; `onAction` is the prototype's `onOpen`, `onMark` its `onReadChange` and `onArchive`.
