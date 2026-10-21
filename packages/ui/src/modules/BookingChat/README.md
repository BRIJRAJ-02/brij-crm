# BookingChat

Book by chat on the public booking page (spec 0041): the conversation, the last reply's times grouped by day and its suggestions as buttons, then the message field and Send.

## Why it exists

New. Nothing in the library draws a conversation: ActivityFeed and NoteList are records of what happened, read top down with no input, and the booking modules (SlotList, BookingDetails) are steps of a form. The parts inside are the library's own: the times and suggestions are Buttons (secondary at the `lg` size a time needs, ghost for suggestions), the field is Field (`isWrapping`, so Enter sends and a long message wraps), and a failure is a Callout with Try again. Its own CSS is only the thread's layout and the two speech surfaces.

## Use

```tsx
<BookingChat
  lines={lines}
  isWaiting={sending}
  error={failed}
  onRetry={sendAgain}
  onSend={send}
  onPickTime={pick}
/>
```

- `lines` are the conversation, oldest first. An assistant line may carry `days` (times grouped under the day's name, each with the label shown and the name a screen reader says) and `suggestions`; only the last assistant line's are drawn, since older ones may no longer be open.
- `onSend` gets typed text and a suggestion's words; `onPickTime` an offered time's id. The page turns a time into words the agent reads back, so tapping and typing go through one parser.
- `isWaiting` holds the field and shows a spinner line; `isDone` ends the chat once it booked.
- `maxLength` (500) stops typing at the limit; the count shows near it.

## States

Empty (the greeting only), a few turns, offers, suggestions, waiting, error with Try again, done. Hover, focus and pressed come from Button and Field.

## Keyboard and screen readers

The thread is a log (`role="log"`, polite), so each reply is read as it arrives, with who said it. Each day's times are a labelled group ("Times on Tue 27 Oct"). Tab moves from the times to the suggestions to the field and Send; Enter in the field sends, and focus stays there.

## Differences from the artifact

Not in the artifact.
