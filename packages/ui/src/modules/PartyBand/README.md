# PartyBand

A reservation's party size as checklabs' booking form asks for it (spec 0066 B7, 5 November 2026): one soft band in
the chip colour with large corners, "Party size" (a strong label, spec 0072) over "Up to 4 guests" at its start, and one fewer,
the count and one more at its end (the shared Stepper). With a fewest above one the line reads the range ("2 to 4
guests"), so one fewer turning off at 2 says why. At the most the page takes online, a quiet line under the band says how to book a
bigger table: "More than 4? Call 020 7946 0000", the phone a link, or "Call the restaurant." without one.

## Why it exists

New. The reservation page asked for the party with ChoiceChips (2, 3, 4 in a cramped 11px row), which reads as a
choice among few rather than a count, and stops at whatever chips fit. checklabs counts the party with − and + in a
band of its own, defaulting to 2; nothing in the library draws a labelled band with a count at its end and a line
under it at the limit. ChoiceChips, SegmentedControl and Field each draw something else, and a variant of any of them
would be a second component inside it. Stepper is the count itself, and the band uses it; but the band's caps label
and its range line sit beside the count rather than over it (Stepper's own label), on the chip colour, with the way to
book a bigger table under it at the most: a reservation's wording and layout, not a size or tone of a count.

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

## Timefix prototype (spec 0072)

Takes its look from BusinessPage (spec 0072): the prototype's BusinessPage draws its own PartyBand, the party size as ChoiceChips (1 to 7, then 8+) with a line opening under them for a bigger party. The library's band counts with the shared Stepper (the owner's choice after checklabs, 5 November 2026), so it cannot render the prototype's chips without changing what it does (AC-3); it keeps its own module, with the prototype's words where they differ:

- The band's label is the prototype's field label, `text-body-sm-strong` in the text colour, sentence case (was a caps overline, `text-label` with `tracking-kbd`, in `text-secondary`).
- The line under the band for a bigger party is the prototype's party note, `text-body` in `text-secondary` (was `text-label`).
- Kept: the band (`surface-subtle`, `radius-lg`), the range line, the Stepper, and the line's rise under motion (a fade under reduced motion); the prototype's note opens as an accordion (grid rows 0fr to 1fr), the library's line rises in.

Rules it repeats from BusinessPage's prototype: the party note's type and colour. None of BusinessPage's own module.

**Use it for** a reservation's party size (the reserve page). **The consumer provides** `value`, `min`, `max`, `onChange`, `phone` (the prototype's `value`, `max`, `onChange`, `phone`; `min` is the library's).

**Differences from the prototype**: a Stepper, not chips, and no 8+ chip: one more turns off at `max` and the line says how to book a bigger table. States (stories): `Default`, `AtTheMost`, `NoPhone`, `AtTheFewest`.

Cost (`node scripts/part-cost.ts PartyBand --against cec3928a0`, gzipped): 446 -> 440 B.

