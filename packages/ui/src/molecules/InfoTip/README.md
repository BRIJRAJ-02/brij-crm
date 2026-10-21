# InfoTip

A small info button beside a label that needs a word of help. It opens a short popover with plain text and an optional example.

## Why it exists

New (the owner, 21 October 2026: "add some info tag … where it can go confusing", starting from a booking page's Limits). Tooltip was tried first and can't hold it: it opens on hover and focus only, so a phone can't open it at all; it is one line on the inverse surface with `pointer-events: none`, so it can't hold an example or be read at leisure; and it describes its trigger rather than being content a screen reader can move through. A Tooltip variant would have changed all of that, which is a different component. So InfoTip composes what exists: a ghost icon only `Button` (`info`) and a `Popover` with a `label`, which opens as a named dialog. No new tokens.

## Use

```tsx
<SettingsRow title="Minimum notice" meta={<InfoTip label="Minimum notice" example="With 4 hours, …">How far ahead someone has to book.</InfoTip>}>
  …
</SettingsRow>
<span>Unique <InfoTip label="Unique">No two records can share a value.</InfoTip></span>
```

- `label` is what it explains, as the label beside it says it; the button and the popover are named "About <label>".
- `children` is one or two plain sentences on what the setting does. `example` adds a worked example under its own quiet label.
- Use it only where the label alone isn't clear. Never on an obvious field (Name, Email), and never to repeat the label.
- `size`: `sm` (the default, a chip's size) beside a label or a row's title; `md` (a control's height) beside a control.
- Beside a Field's or a Select's label, pass it as the control's `info` rather than placing it next to the control. It clears React Aria's button context, so inside a Select it stays its own button and never becomes the Select's trigger.
- `placement` follows Popover (`bottom start` by default) and flips when there is no room.

## States

Closed, hovered (the ghost button's hover), focused (the focus ring), open. Opened from the keyboard it appears at once; from a pointer it grows from the button. Read only and disabled don't apply: help is always reachable, even beside a locked setting.

## Keyboard

Tab reaches the button; Enter or Space opens the help and moves focus into it; Esc, or a press outside, closes it and focus returns to the button.

## Differences from the artifact

Not in the artifact yet; it goes with the next `pnpm ui:artifact`.
