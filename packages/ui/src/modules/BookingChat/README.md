# BookingChat

Book by chat on the public booking page (spec 0042): the conversation, the last reply's times grouped by day and its suggestions as buttons, then the message field and Send.

## Why it exists

New. Nothing in the library draws a conversation: ActivityFeed and NoteList are records of what happened, read top down with no input, and the booking modules (SlotList, BookingDetails) are steps of a form. The parts inside are the library's own: each day's times are the booking page's own SlotList (`variant="offers"`, so a time looks the same in Month, List and Chat and pressing one acts rather than picks), suggestions are round secondary Buttons (chips, as an AI chat's quick replies), the field is Field (`isWrapping`, so Enter sends and a long message wraps), and a failure is a Callout with Try again. Its own CSS is only the thread's layout and the two speech surfaces.

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
- `isLoading` draws `BookingChatGhost` while the page's times load: the chat's own shape (the greeting's bubble, a day's label over six times, the prompt box at the foot), each where the loaded chat puts it, so the times fill in rather than arriving into an empty card (4 November 2026, it was two grey bars). The ghost is exported from `@crm/ui/public-booking` itself, in the page's first load, so the page draws it before this module's own chunk arrives; `BookingChat.browser.test.tsx` holds its places to the loaded chat's within 4 px; `isWaiting` holds the field and shows a spinner line ("One moment" for screen readers); `isDone` ends the chat (it booked, or the page closed), with `doneNote` read out.
- `error` is a Callout: Try again with `onRetry`, Start over with `onRestart`, and `isPause` (too many at once) says it as a warning rather than a fault.
- After a time or a suggestion is pressed its buttons leave with the reply, so focus moves to the field.
- The thread is twelve rows tall on its own, scrolls, and takes focus so it scrolls from the keyboard in every browser. In a view of a set height (the booking card, whose month sets its size in every view) the chat fills it: the thread takes what the composer leaves, so the composer stands at the foot from the first frame.
- The composer is a prompt box (the owner, 25 October and 4 November 2026: "a prompt box, not a search box", "this box needs to feel like a prompt"), as AI chats draw theirs: one raised box two rows tall (`--size-toolbar` plus `--space-24`, the ghost's composer too), a step above the card (in dark a lighter surface, in light white with `--shadow-md`), a `--control-border` edge that holds 3.5:1 in both themes, the focus ring on the box, the message at its top growing a line at a time, and a round Send at its bottom end: always there, secondary while there is nothing to send, the accent once there is. Enter sends. The field is Field's `cell` variant, the one for a field whose container draws the box and the ring.
- Its placeholder follows the conversation: each assistant line may carry `prompt` ("Which time?", "Your name and email", "Yes, or what to change"), and the box asks the last reply's, else "When works for you?". The page decides the words; the module only shows them.
- On a phone the card is taller than the screen, so the composer is sticky at the window's foot (`env(safe-area-inset-bottom)`, with `viewport-fit=cover` on the booking page) while the card is on screen: never under Safari's floating toolbar. BookingFrame lets the chat's cover overflow so the stickiness reaches the window.
- `maxLength` (500) stops typing at the limit; the count shows near it.

## Looks like a chat (owner, 4 November 2026)

- `host` (`name`, `image`, `label`) is who speaks: the host's first name, or a team page's name, over the first message of each run, and their face (the rail's picture or initials, `Avatar` `md`) at the run's foot, level with the bubble's last line. `visitorName` gives the visitor's initials beside their messages once the chat has heard it, and a plain person mark before that. Every line keeps the face's place, so a run's bubbles share one edge.
- The host's bubbles are neutral (`--surface-sunken`); the visitor's are in the page's accent with on-accent text. The corner nearest the face is the small one. Lines in a run sit close, and a new speaker starts further down.
- The visitor's possible answers wear the accent, outlined: the times as round chips and the quick replies at the visitor's side. These reuse SlotList's and Button's own colour names, set on the offers and suggestions.
- While a reply is out, the host types: three dots in their bubble (still under reduced motion).
- `answer` on a line (`email`, `tel`, `name`) sets the prompt box's keyboard and autofill. The box's accessible name is the current question.
- On a phone the page is the only scroller: the thread takes its whole height, the card follows the chat (BookingFrame), and the newest line comes into view above the sticky box. While the chat is on the page, `scroll-padding-block-end` keeps a focused time clear of the box (WCAG 2.4.11).

## States

Loading, the greeting with times, no times, a few turns with the read back, waiting, failed (Try again), paused (a warning), start over, done. Hover, focus and pressed come from Button and Field.

## Motion

A time picked from a reply stays on that reply as the record (SlotList's `answered`): marked with a check, the others quiet, none pressable again; the reply's offers no longer vanish while the next answer is written. A reply writes itself: its words resolve out of a soft blur one after another (about 25 words a second, stageshow's ai-chat pace, so it reads along as it arrives; past 40 words the rest arrive together), and its times and suggestions arrive after its words. The whole text is in the log from the start, so it is read once. While a reply is out, the waiting line shows its words beside the spinner with a light passing across them. Reduced motion shows whole replies and a plain waiting line.

## Keyboard and screen readers

The thread is a log (`role="log"`, polite), so each reply is read as it arrives, with who said it. Each day's times are a labelled list ("Times on Tue 27 Oct"). Tab moves from the times to the suggestions to the field and Send; Enter in the field sends, and focus stays there.

## Differences from the artifact

Not in the artifact.
