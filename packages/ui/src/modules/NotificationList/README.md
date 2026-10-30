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

- An item is `{ id, kind, actor, createdAt, isRead, isDone, record?, isNote?, formName?, excerpt }`; the sentence comes from the kind ("Ada Lovelace mentioned you", "replied in a thread", "assigned you a task", and the system's "Your task is due today" on a task's due day, which names nobody), and a form's new submission (`form_submission`, spec 0023) is named by its form instead of its actor: "Contact us got a new submission", with the record it filed as the chip and no excerpt. An actor that isn't a member (a form, the system) shows its mark from RecordChip's `ACTOR_ICONS` on Avatar's soft gray square, not initials, so it never reads as a person.
- Unread rows show the accent dot and a bolder sentence, and read "Unread" first to a screen reader.
- The order is the screen's (newest first). A row still loading draws a skeleton and tells the source it is on screen, which loads the next 50.

- `isNote` on a mention says it was in a note ("Ada mentioned you in a note"); its excerpt is the note's title.

## States

Unread, read, done, loading (skeleton rows), empty (in the screen's words, with an optional `emptyBody` line saying what lands here, and its actions), failed with Try again, and no access.

## Keyboard

The arrows move between rows, Enter opens one. On a focused row, U marks it read or unread and E marks it done or moves it back to the inbox; the row's menu shows both with their keys.

## Differences from the artifact

The artifact has no inbox yet; this is code first, published with the next `pnpm ui:artifact`.
