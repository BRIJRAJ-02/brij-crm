# NumberPop

A worded number whose changed digits pop in (spec 0068, AC-6806): prices, totals, "42 going" on public pages (the dashboard keeps plain numbers). When `value` changes, the characters it shares with the last value at the start hold still, and the rest rise `space-8` out of a soft blur on the move duration, the last two one and two staggers behind (transitions.dev's number pop in). The first value is simply there.

## Why a new part

Badge counts and Stats show numbers but never move them; the owner asked for the small motion of a value changing (1 November 2026). One part keeps every page's numbers moving the same way.

## States

Still (the first value, or reduced motion) and changing. Screen readers read the whole value once (a visually hidden copy), never digit by digit; whoever shows it decides whether a change is announced.

## Use

The caller formats (`£45`, `3 changes`); NumberPop only moves. Digits sit on tabular figures, so a changing count never shifts the words after it.

## Differences from the artifact

Not in the artifact yet; it goes with the next `pnpm ui:artifact`.
