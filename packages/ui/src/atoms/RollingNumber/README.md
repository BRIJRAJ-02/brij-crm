# RollingNumber

A count that rolls only the digits that changed, a beat after the edit that fed it.

## Why it exists

The owner asked for the small details that make a count feel answered rather than reset (1 November 2026): 1,284 becoming 1,285 should move one digit, not redraw the number. Nothing in the library did that. It is not a Badge variant, because Badge is the chip around a count (its size, tone, cap and language); this is how the number inside any such chip changes. Badge draws its count through it, so every tab count, table count, board column count and record stat gets it with no call site change.

## Use

```tsx
<RollingNumber>{1285}</RollingNumber>
```

- `children` is the count, already formatted by the caller when it needs grouping or a cap (`Badge` does both).
- The beat before the roll is `duration-press`: the edit is seen first, then the count answers it.
- Only characters that differ from the ones on screen roll; the rest hold still. A character that has never changed never animates, so a list of counts drawing for the first time is quiet.
- Between rolls the count is one piece of text, so anything reading or testing it sees a plain number. While a roll is in flight the characters are drawn, not spoken: the whole count sits beside them, so a roll is never spelled out digit by digit.

## States

- **Steady:** the count, in tabular figures so it never shifts width as digits change.
- **Rolling:** the changed characters rise into place over `duration-move`.
- **Reduced motion:** the count changes, with no beat and no roll.

## Keyboard

It takes no focus.

## Differences from the artifact

New in code; it has no artifact card yet, and goes to the artifact with the next `pnpm ui:artifact`.
