# MatchCalendar

Match with your calendar on a public booking page: the call to action above the card (`MatchCalendarCta`), and the dialog behind it (`MatchCalendar`), a four state flow that connects the visitor's calendar for this visit, then offers the best time both people are free.

The owner asked for it on 25 October 2026: "a big CTA that clearly says Match with your calendar", then, shown the small Connect your calendar link, "yea this but a pop up that has a flow to it". It creates no account, asks for no new Google permission, and keeps nothing after the visit: it is the flow around what spec 0028 already does (AC-720 to AC-726).

## Why it exists

New. The small link in VisitorBar sends the visitor straight to Google with only a tooltip to say why, and what came back was a change in the times behind them, which a visitor had to notice for themselves. This says what it does first, holds its shape while the trip happens, and tells the visitor the answer in a sentence. The parts are the library's own: Modal, Button and ButtonLink (with Google's mark through `provider`), Avatar, Skeleton, Icon, and the booking page's own SlotList (`variant="offers"`) for the other matching times, the same control the booking chat offers times with. Its own CSS is the two faces side by side, the dots that travel between them, and the message block's held height.

## Use

```tsx
<VisitorBar
  match={{
    step,
    isOpen,
    onOpenChange: setOpen,
    host: { name: page.hostName, image: page.hostImage },
    visitor: known,
    connectHref,
    result: { count: 7, best, when: '9:30 AM on Tue 20 Oct', days: others },
    onBook: book,
    onShowAll: () => setShowAll(true),
  }}
/>
```

- It is controlled, because the trip to Google is a full page navigation: the page reopens the dialog on the way back (`?calendar=` in the return address, `apps/web/src/public/booking/visitor.ts`) and sets `step` from what came back.
- `host` and `visitor` are the two faces, each with their picture when the page has one and their initials when it hasn't. Before Google says who the visitor is, their side is a held circle.
- `result.when` is the best time in words ("9:30 AM on Tue 20 Oct"), so the dialog can ask about it in a sentence; `result.count` is how many matched, which keeps the answer from reading as a lucky guess; `result.days` are the rest, revealed by See the other times and bookable where they stand.
- `onBook` takes a time's id, the slot start the page keys times by, the same id SlotList gives.
- `MatchCalendarCta` is the call to action: the row's width, a primary `xl` button (Button's size for a page's own call to action outside the app) with one quiet line under it. The booking page no longer draws it (spec 0058, AC-24, 31 October 2026: Connect your calendar became a small secondary link that opens this dialog); it stays in the library for a page that wants the large ask. In VisitorBar, a visitor we don't know reaches the dialog from the small link, and a visitor we know reaches the same dialog from their own tag's menu, since taking their standing tag away would undo AC-720 to AC-726.
- `isLoading` on the call to action holds exactly the same box, so the card under the row never moves when it fills.

## States

The four the flow has, as `step`:

- `why`: what it does, and what it reads (free or busy only, never what is on the calendar, and only for this booking). Not now, then Continue with Google.
- `waiting`: the host and the visitor side by side with three dots travelling between them and the two of them leaning in, under "Matching your calendars". The visitor's side is still a held circle until Google answers. Close is the way out: the page behind stays usable.
- `matched`: "You're both free at 9:30 AM on Tue 20 Oct. Shall we book it?", how many matched, and why this one is first. Not now, See the other times, and Book this time. Every step has a dismiss first with its ESC keycap, so the one question the dialog asks always has a visible no.
- `unmatched`: no open time in common, with Show all times, which closes the dialog and shows every time the host is open.
- `failed`: the calendar couldn't be read, with Try again (back to Google) and Close.

Loading is the `waiting` step, and the held circle is its skeleton. There is no error state of its own: `failed` is it. Hover, focus, pressed and the open and close animations come from Button, Modal and SlotList.

## What "best" means

The server picks it, and nothing new is invented here: the soonest times both are free that sit inside 9 AM to 6 PM in the visitor's own zone with fifteen minutes clear either side, at most three (`packages/core/src/booking/overlay.ts`, `BEST_MAX`). When fewer than three pass, the soonest shared times fill the rest. The dialog says it in a line a visitor can check: "This is the soonest one in working hours, with a gap either side." Where the server found no time that passed those tests (`result.best.isBest` is absent), the first shared time is offered without the claim: "This is the soonest time you're both free." The count is every match across the days the page has read; See the other times offers the next few, and the page behind holds the rest, which is why the group is named "The next matching times".

## Keyboard

The call to action is a button: Tab reaches it, Enter or Space opens the dialog. Inside, focus is held by Modal and Tab cycles; Esc closes every state, including `waiting`, so a visitor is never stuck. See the other times goes with its press, so focus moves to the first of the times it drew. A visually hidden status says each step as it changes under the visitor ("Matching your calendars. One moment.", then the answer), and the message block carries `aria-busy` while it waits, so a reader arriving with the dialog already open and waiting hears the state without needing a change to fire.

## Motion

The dots cross the gap in `duration-pulse`, a third of a cycle apart, and the two pictures lean a few degrees towards each other on the same beat (the pictures only: tilting the names under them read as jitter). The lean's four degrees is the one value with no token behind it; there is no rotation token, and Stylelint's token rules don't reach `rotate`. The mark that replaces them (a tick, a slash, a warning) grows in from `scale-enter` in `duration-popover`. Reduced motion keeps the fades and the dots' turns and drops every movement and the lean. The two faces and the message block keep their size in every step, so the answer landing moves nothing.

## Differences from the artifact

Not in the artifact.
