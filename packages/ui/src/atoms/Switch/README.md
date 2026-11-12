# Switch

Turns a setting on or off at once, with no Save.

## Why it exists

Ported from the artifact's Switch card (version 8). Notification preferences, feature toggles and syncs (#28, #36) take effect the moment they change. It wraps React Aria's `Switch`, so it is announced as a switch. Use Checkbox when the choice is saved with a form.

## Use

```tsx
<Switch label="Email me about mentions" description="Sent within a minute." defaultSelected />
```

- **`isLabelHidden`:** the label is read by screen readers only (a link card's switch).
- **`offStatus`:** a small status word beside the switch while it is off (the link page's "Private", spec 0058), where off has a name of its own. The label stays the visible word and the accessible name ("Live"), so voice control says "click Live" (WCAG 2.5.3); the status is the switch's description, so a screen reader hears "Live, switch, off, Private". It is a data attribute drawn by CSS rather than markup that changes with the state, because the hosted form's first load draws Switch and sits at its budget.
- **`labelContext`:** words only screen readers hear after the visible label, where rows repeat the same switches (Settings › Calendars: "Check for conflicts" on each calendar, heard as "Check for conflicts on Work"). Why: a visible name per switch would repeat the calendar's name three times a row.
  - The switch is then just its 36 by 20 track (32 by 18 in the app), so an invisible hit area grows it past 24px each way. A press just beside the track still toggles it, and nothing drawn changes (the owner asked for controls that can't be missed, 20 October 2026).
  - It uses Button sm's technique, an `::after` on the control. Give it about 2px of room across and 8px up and down before another target.

## States

Off, on (the knob slides with `duration-move`), focus, read only, disabled. Reduced motion moves the knob at once.

## Keyboard

Space toggles it.

## Differences from the artifact

- React Aria's props replace the input attributes; there is no invalid state, since a switch takes effect at once.

## Timefix prototype (spec 0072)

Folded into the prototype's Checkbox (spec 0072): a 36 by 20 track (`size-control` by `space-20`) and a 16px thumb with `shadow-sm`. The thumb stretches 4px while pressed (leftward when on) and travels with the bounce ease's small overshoot over `--duration-medium` (transitions.dev 27).

**Differences from the prototype**: the off track is `control-border`, not the prototype's `border-strong`, which falls under the 3:1 a control's outline needs against the surface (WCAG 1.4.11). The prototype's keyframed double bounce needs a "touched" state, so the transition's single overshoot stands in for it. `offStatus`, `labelContext` and a hidden label's larger hit area are kept.
