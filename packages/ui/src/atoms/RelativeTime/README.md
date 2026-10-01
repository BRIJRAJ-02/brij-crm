# RelativeTime

A moment as "3 hours ago", with the exact time in a tooltip.

## Why it exists

New. The timeline, comments, notifications and timestamps (#17, #19, #28) show recent moments the same way, and keep them current without each screen running a timer.

## Use

```tsx
<RelativeTime value="2026-10-08T11:30:00.000Z" />
```

- It formats in the provider's language with `Intl.RelativeTimeFormat` (`numeric: 'auto'`): "now" under a minute, then minutes, hours and days ("yesterday"), and the date past 7 days.
- It renders again on the provider's shared clock, every 30 seconds, paused while the tab is hidden. Stories freeze it at 8 October 2026, 14:30 UTC.
- The tooltip gives the exact time in the provider's time zone, with the zone's name. Screen readers read the same exact time after the relative one ("3 hours ago, Oct 8, 2026, 12:30 PM GMT+1"), so it never depends on a hover.

## States

None of its own.

## Keyboard

It adds no tab stop; a focused row or cell shows the tooltip. Where nothing focuses it (a DescriptionList), keyboard users who don't use a screen reader see the relative time only.

## Differences from the artifact

Not in the artifact.
