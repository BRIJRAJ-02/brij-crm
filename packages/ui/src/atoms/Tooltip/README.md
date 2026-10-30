# Tooltip

A short line that appears after a pause on hover, or at once on keyboard focus.

## Why it exists

New. Truncated text, exact times, icon only buttons and disabled reasons all need the same small label. It wraps React Aria's `TooltipTrigger`, so it opens on hover and focus, closes on Esc, and is described to screen readers.

## Use

```tsx
<Tooltip content="Archive record">
  <Button icon="archive" label="Archive" />
</Tooltip>
<Tooltip content={fullText} isTextTrigger><span>{cut}</span></Tooltip>
```

- It adds to a name and never replaces it: an icon only button keeps its own `label`.
- `isTextTrigger` wraps plain text, which shows the tooltip on hover and when something focuses it on purpose (a grid cell); it adds no tab stop.
- `isTriggerShared` (with `isTextTrigger`) makes the trigger take an equal share of its flex row. Why a variant: BarStrip's `chart` size (spec 0047) shares its width between its bars, and the bar's trigger is the row's item; styling the trigger from BarStrip would reach into this component.
- `kbd` puts the control's shortcut after the line as a keycap (`Kbd tone="onInverse"`): "Search ⌘K", as Attio's and Linear's tooltips teach their keys (30 October 2026). The keycap is for sight; a library Button inside states the same shortcut as its `aria-keyshortcuts` by itself (through `TooltipKbdContext`, so sight and screen readers learn one key; UX review, 30 October 2026), and any other control states its own. Why a prop: icon buttons had no place to show a shortcut, and typing it into `content` made screen readers say "command K".
- `placement`: `top` (the default), `bottom`, `start` or `end`.
- It opens after 500 ms of resting (spec 0003), at once while another is showing, and at once on keyboard focus.
- `AnchoredTooltip` is the same look opened from outside against an element with no trigger of its own: the grid shows one for all its cells, waiting `TOOLTIP_DELAY_MS` on hover as this does. Labels that may be cut mark themselves `data-truncated`, so such a host can show their full text.
- `isOpen` with `onOpenChange` opens it from outside, as the grid does for its focused cell, where focus sits on the cell and not on the text. Hover still reports through `onOpenChange`, so keep the hover state and open it when either is true.

## LockReason

`<LockReason reason="…" />` is a quiet lock button whose name is the reason, with the reason in this tooltip. Put it beside anything that can't change (a computed value, a locked card, a task you can't tick), so the reason is reachable by keyboard as well as by pointer. `size="sm"` is a chip's 20px with a smaller lock, for beside an 11px label: a read only attribute's name in a record's details, where a full size button after the value read as a loose icon.

## States

Hidden, showing. Opened from the keyboard it appears at once; from a pointer it fades in.

## Keyboard

Focus on the trigger shows it; Esc hides it.

## Differences from the artifact

Not in the artifact.
