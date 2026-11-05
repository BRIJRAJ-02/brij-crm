# PartyBand

A reservation's party size as checklabs' booking form asks for it (spec 0066 B7, 5 November 2026): one soft band in
the chip colour with large corners, "PARTY SIZE" (a caps overline) over "Up to 4 guests" at its start, and one fewer,
the count and one more at its end (the shared Stepper). At the most the page takes online, a quiet line under the band says how to book a
bigger table: "More than 4? Call 020 7946 0000", the phone a link, or "Call the restaurant." without one.

## Why it exists

New. The reservation page asked for the party with ChoiceChips (2, 3, 4 in a cramped 11px row), which reads as a
choice among few rather than a count, and stops at whatever chips fit. checklabs counts the party with − and + in a
band of its own, defaulting to 2; nothing in the library draws a labelled band with a count at its end and a line
under it at the limit. ChoiceChips, SegmentedControl and Field each draw something else, and a variant of any of them
would be a second component inside it.

## Use

```tsx
<PartyBand value={party} min={page.partyMin} max={page.partyMax} onChange={setParty} phone={page.place.phone} />
```

The page holds the count. `min` and `max` turn one fewer and one more off at the limits; a press that reaches one
moves focus to the other button, so focus never falls out of the band.

## The stepper

The shared Stepper molecule at its 40px `md` size (cherry-picked from wip/hosp-theme, "feat(ui): Stepper"): a white
hairline pill on the band's chip colour, 36px round buttons pressed across 44px, the count in the heading style and a
polite live region. The band's own words name it, so its label is for screen readers only.

## States

The count between the limits, at the fewest (one fewer off), at the most (one more off and the line under the band),
with and without a phone, focus on either button, pressed. Under reduced motion the line fades in without moving.

## Keyboard

Tab reaches one fewer and one more; Enter or Space presses. The count is a polite live region, and the line at the
most is a status, so both are said as they change.

## Differences from the artifact

Not in the artifact.
