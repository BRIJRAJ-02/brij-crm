Small text utilities every screen leans on: a cut name that explains itself, a live relative time, a separator, screen-reader-only text and an attribute path.

**Use it for**: `TruncatedText` for names and values in fixed-width cells; `RelativeTime` for when something happened (activity, comments, "Saved 2 min ago"); `Separator` between groups, or with `label="or"` between two ways to continue; `VisuallyHidden` for words only a screen reader needs (a skip link, "opens in a new tab"); `Path` for an attribute reached through relations in filters, formulas and variables. **Don't** use RelativeTime for a time someone set (a meeting start): format that with `formatClock`.

**The consumer provides**: TruncatedText `children` (a string), `lines` 1 or 2, `isNumeric`. RelativeTime `value` (Date, ISO or epoch), optional `now` (else a 30s live clock), `hour12`. Separator `orientation`, `label`. VisuallyHidden `isFocusable`, `isInline`, `id`. Path `parts`.

**States**: TruncatedText is focusable and shows its Tooltip only while it is actually cut (measured with a ResizeObserver). RelativeTime reads "just now", "5 min ago", "3 hours ago", "Yesterday", "4 days ago", then a date.

**Interaction**: RelativeTime is focusable; the exact time ("Mon 9 Nov 2026, 9:30 AM") shows in a Tooltip and is read after the relative words. When the words tick over they crossfade in place (`SoftText`, transitions.dev 34 text swap soft: 150ms fade, width easing over 250ms), so neighbours glide instead of jumping. Path is heard as "Company, then Owner".

**Replaces**: TruncatedText, RelativeTime, Separator, VisuallyHidden, Path.
