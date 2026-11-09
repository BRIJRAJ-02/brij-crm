Progress shows how far along a task is, and how much of a limit is used.

**Use it for**: `ProgressBar` for work the user waits on (an import, an upload); indeterminate when the length is unknown (a calendar sync). `Meter` for a quantity against a limit (bookings this month, seats, storage). For plan usage split by what used it, render Chart's `DonutChart` with a grey `track` "Remaining" segment (the one donut in the system). **Don't** use a progress bar for a short save (use the button's spinner) or a donut for more than five slices.

**The consumer provides**: ProgressBar takes `label` (or `aria-label`), `value`, `maxValue`, `isIndeterminate`, `showValue` (true or a string such as "2 of 6"), `size` (`sm` 4px, `md` 6px). Meter takes `label`, `value`, `maxValue`, `valueLabel`, `warnAt` (0.8), `dangerAt` (0.95) and a `hint`.

**States**: determinate, indeterminate, complete; meter normal (blue), warning (amber plus hint), danger (red value plus hint).

**Interaction**: the fill eases to each new value over 400ms. Reduced motion draws the new values at once.

**Replaces**: ProgressBar, Meter. The donut that used to live here is merged into Chart's `DonutChart`.
