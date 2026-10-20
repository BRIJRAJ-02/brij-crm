# BookingFrame

A booking page's frame (spec 0025, 0025-experience.md; layout after the timefix booking page and calendars' scheduling pages): one card with the host and the meeting's facts in a rail at its start, the month in the middle, and the chosen day's times at its end, each pane divided by a hairline. Under the card, the Timefix wordmark and "Claim your free page". On screens under the page breakpoint the panes stack. This folder also holds `BookingFoot` (that foot alone, for the guest's booking page) and `BookingMessage` (one small card for a page with nothing to book: loading, not found, paused, or failed with Try again).

## Why it exists

New. The public booking page moved onto the library on 20 October 2026 (as the hosted form did), and no layout held a rail beside two panes in one card. PageColumn and PreviewLayout are app pages inside the shell; AuthLayout is one narrow card.

## Use

```tsx
<BookingFrame
  host={{ name: 'Ada Lovelace' }}
  title="Intro call"
  facts={[{ id: 'length', icon: 'clock', children: '30 min' }]}
  toolbar={<SegmentedControl … />}
  aside={<SlotList … />}
  claimHref="https://timefix.ai"
>
  <MonthTiles … />
</BookingFrame>
```

`aside` adds the end pane; leave it off for one wide pane (the details step). A fact's `children` may be a control (the time zone's Select). `banner` sits above the card (the visitor's calendar, spec 0028). Without `host` and `title` the frame draws skeletons.

## States

Three panes, two panes, loading; BookingMessage's loading, message and Try again.

## Keyboard

None of its own. BookingMessage focuses its heading as it shows.

## Differences from the artifact

Not in the artifact.
