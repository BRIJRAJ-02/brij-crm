# TimeSelect

A time of day picked from a list a step apart, on a 12 or 24 hour clock: working hours and availability rows (spec 0073, AC-7306).

## Why it exists

A thin wrapper over Select's `time` variant, so a time works like every other Select and adds no CSS. HoursEditor builds the same list privately; TimeSelect shares it, with `timeOptions` and `formatTime` exported for summaries ("Mon 9:00 AM to 5:00 PM"). HoursEditor moves onto it when phase 6 ports the hours screens. An exact typed time (a reminder at 8:07) stays Field's `temporal={{ type: 'time' }}`.

## Use

```tsx
<TimeSelect label="Starts" value={start} onChange={setStart} />
<TimeSelect label="Ends" isLabelHidden size="sm" hourCycle={12} from={minutesOf(start) + 15} value={end} onChange={setEnd} />
```

- Values are `HH:MM` on a 24 hour clock; `null` is none chosen.
- `step` (15 by default, as Cal.com lists them), `from` and `to` in minutes from midnight: an end time starts after its start.
- `hourCycle` 12 or 24; left out, the reader's language decides.
- `timeOptions({ locale, step, hourCycle, from, to })` lists the times; `formatTime(value, locale, hourCycle)` writes one (`HH:MM` in, "9:30 AM" out). Both are pure.
- `readOnlyReason` says why it can't be changed.

## States

Empty ("--:--"), a time, open (the list at the trigger's width), invalid (`error`), disabled, read only.

## Keyboard

Select's: Enter or Space opens, the arrows move, typing jumps to a time, Enter picks, Esc closes.

## Differences from the artifact

None in behaviour. The prototype's typed TimeField is Field's `temporal` time here, so the app has one typed time.
