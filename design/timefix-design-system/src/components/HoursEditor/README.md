HoursEditor sets weekly availability: which days are open and the hours of each.

**Use it for**: working hours on a schedule, a booking page's own hours, and availability rules. **Don't use it for** one-off date overrides (a date list) or a meeting's own time.

**The consumer provides**: `value`, a week of `{ on, ranges }` with ranges in minutes from midnight and a stable `id`, `onChange`, and `hour12`. `HoursSummary` is the one-line header ("Mon–Fri · 9:00 AM – 5:00 PM, with changes on Tue and Thu", then "Thu has overlapping times" in red; it truncates), built from `summarizeHours` and `summarizeHoursProblem`; `hoursProblem` is the same check the editor shows.

**States**: days are separated by full-width hairlines. A day on shows its ranges; off shows a grey "Unavailable" and keeps its ranges for when it comes back. A second range stacks under the first with a remove button. An end before its start, or ranges that overlap, outline both TimeSelects in red and open a message under the row.

**Interaction**: the switch toggles the day (toggle with overshoot). Times are the shared `TimeSelect` (15 minute steps, opens scrolled to the current time; the pick ticks, then the list closes 120ms later). Adding a range opens it from 0fr to 1fr over 250ms, so the row grows; removing collapses it the same way. A new problem shakes the row once (error shake: 6px, 280ms). "Copy times to…" opens the shared Popover of day checkboxes with Every day and Apply; the days it changed get a brief blue wash. Everything works by keyboard.

**Replaces**: HoursEditor, RulesEditor.
