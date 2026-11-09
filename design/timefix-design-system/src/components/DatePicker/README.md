DatePicker picks a day or a span of days, and DateNav steps a calendar or roster through days, weeks and months.

**Use it for**: `Calendar` inline where the month is the page (booking, availability). `DatePicker` for one date in a form or a record's date field. `DateRangePicker` for report and filter spans, with presets. `DateNav` at the head of a time grid. **Don't use it for** times alone (TimeField) or a year of birth (type it).

**The consumer provides**: `label`, `value` / `onChange` (`@internationalized/date` values), `minValue`, `isDateUnavailable`, `description`, `errorMessage` with `isInvalid`. DateRangePicker takes `presets` (default Today … Last month). DateNav takes `date`, `onDateChange`, `view`, `onViewChange`, `views`, `enableShortcuts`.

**States**: day rest, hover, today (accent ring), chosen (accent fill), in range (accent-soft band, ends filled), unavailable (grey, struck), outside the month (hidden), focused (ring). Field: empty segments, typed, open, invalid, disabled. Preset active (accent-soft).

**Interaction**: type each segment, or ↑ ↓ to change it; the calendar button or Alt+↓ opens the month; arrows move days, Page Up/Down months, Enter picks. A new month slides in a small step from the side it came from (transitions.dev 08). A preset fills both ends, then closes 120ms later. DateNav: T today, K previous, J next (shown in tooltips); the label crossfades (TextSwap) and Day/Week/Month is the shared SegmentedControl (small), whose pill slides (16).

**Replaces**: DatePicker, DateNav, the Date and Timestamp field editors' pickers.
