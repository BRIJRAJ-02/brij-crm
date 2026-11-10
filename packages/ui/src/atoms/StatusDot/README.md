# StatusDot

A status as a dot in its hue, then its label.

## Why it exists

Ported from the artifact's StatusDot card. It is the status attribute's one display (cells, the record panel, cards, filters, board column headers). Screens render it through the field set, never directly. The one exception is the status page's health dot, which is the system's state, not an attribute value (its import carries an ESLint disable saying so). Inside the library, TeamList (spec 0041) draws a member's presence with it too: a state in words with a dot, not an attribute value. Settings › Webhooks (spec 0064) is the other exception: an endpoint's state and a delivery's, both the system's own, each import carrying the same disable.

## Use

```tsx
<StatusDot hue="green">Active</StatusDot>
<StatusDot hue="orange" isArchived>Paused</StatusDot>
```

- The label always shows (or its `shortLabel` in a narrow container); the dot's colour is never the only cue.
- `isArchived` turns the dot gray and adds "(archived)" for screen readers.
- `shortLabel`: a word or two shown in place of the label in a narrow container (under 480px, a phone's bar), so the dot never stands alone; the full label stays in the accessibility tree as a visually hidden copy (read at every width; the shown words are `aria-hidden`). Why a variant: an editor's status in the TopBar was cut to "D." beside the name on a phone, which said nothing (22 October 2026). The dot alone was tried and turned down: colour would be the only cue, and Draft and Paused share a gray dot (WCAG 1.4.1; decided 22 October 2026). EditorStatus (PreviewLayout) passes Live, Edited, Draft or Paused.
- `isInherited` takes the words' colour and type from where it sits instead of its own `text` and `text-body`: inside a SegmentedControl segment or a menu item, a calendar's dot and name read like the other segments, secondary until chosen and strong. Why a variant: as is, the dot's own colour and type overrode the segment's, so coloured segments stood apart from plain ones and never dimmed (the owner's calendar switch on Bookings' week, 22 October 2026).
- `isAnimated` plays a change: the dot's colour fades to the new hue (`duration-move`, `ease-out`) and the words swap through TextSwap (loaded with the first dot that animates, so tables and public pages never carry it). For a status the control it sits on changes: a booking page's Live or Hidden pill (Button's `dot` with `animateLabel`, the owner's mock of 9 November 2026). Why a variant: the dot and its words are StatusDot's; a pill drawing its own dot would be a second dot.

## States

Archived, ShortLabel (wide and narrow), ArchivedShortLabel and Animated.

## Keyboard

It takes no focus.

## Differences from the artifact

- `hue` replaces `color`, and is required; `isArchived` is new.
