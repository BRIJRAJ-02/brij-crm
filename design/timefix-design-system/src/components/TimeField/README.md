TimeField sets a time of day, either picked from a list in 15-minute steps (TimeSelect) or typed in segments (TimeField), on a 12- or 24-hour clock.

**Use it for**: `TimeSelect` in availability and working hours rows, where times fall on a grid (Cal.com). `TimeField` for an exact time someone types (a reminder at 8:07, a cut-off). **Don't use it for** a date and time together (DatePicker with time granularity) or a duration (a number with "min").

**The consumer provides**: `label` (hide it with `isLabelHidden` inside a row, it stays for screen readers), `value` / `onChange` ("HH:MM" for TimeSelect, a `Time` for TimeField), `hourCycle` 12 or 24, `step` and `from` (an end time starts 15 minutes after its start), `isInvalid` with `errorMessage`, `isDisabled`. `timeOptions` and `formatTime` are exported for summaries ("Mon 9:00 am – 5:00 pm").

**States**: empty ("--:--"), set, open (list scrolled to the current time, ticked), invalid (red edge and line), disabled; a focused segment fills with accent.

**Interaction**: TimeSelect works as Select: Enter opens, arrows move, typing jumps, Enter picks; the tick draws and the list closes 120ms later; the list grows from the field (transitions.dev 05). TimeField: type digits or use ↑ ↓ per segment, ← → between them, A or P for the period.

**Replaces**: the time inputs in HoursEditor, TimeInput.
