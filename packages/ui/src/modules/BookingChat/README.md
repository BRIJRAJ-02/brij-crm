# BookingChat

Book by chat on the public booking page (spec 0042): the conversation, the last reply's times grouped by day and its suggestions as buttons, then the message field and Send.

## Why it exists

New. Nothing in the library draws a conversation: ActivityFeed and NoteList are records of what happened, read top down with no input, and the booking modules (SlotList, BookingDetails) are steps of a form. The parts inside are the library's own: each day's times are the booking page's own SlotList (`variant="offers"`, so a time looks the same in Month, List and Chat and pressing one acts rather than picks), suggestions are ghost Buttons, the field is Field (`isWrapping`, so Enter sends and a long message wraps), and a failure is a Callout with Try again. Its own CSS is only the thread's layout and the two speech surfaces.

## Use

```tsx
<BookingChat
  lines={lines}
  isWaiting={sending}
  error={{ message, onRetry: sendAgain }}
  onSend={send}
  onPickTime={pick}
/>
```

- `lines` are the conversation, oldest first. An assistant line may carry `days` (times grouped under the day's name, each with the label shown and the name a screen reader says) and `suggestions`; only the last assistant line's are drawn, since older ones may no longer be open.
- `onSend` gets typed text and a suggestion's words; `onPickTime` an offered time's id. The page turns a time into words the agent reads back, so tapping and typing go through one parser.
- `isLoading` draws a skeleton while the page's times load; `isWaiting` holds the field and shows a spinner line ("One moment" for screen readers); `isDone` ends the chat (it booked, or the page closed), with `doneNote` read out.
- `error` is a Callout: Try again with `onRetry`, Start over with `onRestart`, and `isPause` (too many at once) says it as a warning rather than a fault.
- After a time or a suggestion is pressed its buttons leave with the reply, so focus moves to the field.
- The thread is twelve rows tall, scrolls, and takes focus so it scrolls from the keyboard in every browser.
- `maxLength` (500) stops typing at the limit; the count shows near it.

## States

Loading, the greeting with times, no times, a few turns with the read back, waiting, failed (Try again), paused (a warning), start over, done. Hover, focus and pressed come from Button and Field.

## Keyboard and screen readers

The thread is a log (`role="log"`, polite), so each reply is read as it arrives, with who said it. Each day's times are a labelled list ("Times on Tue 27 Oct"). Tab moves from the times to the suggestions to the field and Send; Enter in the field sends, and focus stays there.

## Differences from the artifact

Not in the artifact.
