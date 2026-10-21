# NotificationList

The inbox's rows: who did what, on which record, the comment's start or the task's title, when, and whether it is read.

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

- An item is `{ id, kind, actor, createdAt, isRead, isDone, record?, excerpt }`; the sentence comes from the kind ("Ada Lovelace mentioned you", "replied in a thread", "assigned you a task").
- Unread rows show the accent dot and a bolder sentence, and read "Unread" first to a screen reader.
- The order is the screen's (newest first). A row still loading draws a skeleton and tells the source it is on screen, which loads the next 50.

## States

Unread, read, done, loading (skeleton rows), empty (in the screen's words, with its actions), failed with Try again, and no access.

## Keyboard

The arrows move between rows, Enter opens one. On a focused row, U marks it read or unread and E marks it done or moves it back to the inbox; the row's menu shows both with their keys.

## Differences from the artifact

The artifact has no inbox yet; this is code first, published with the next `pnpm ui:artifact`.
