# Badge

A small count beside a tab, a nav item or a list heading.

## Why it exists

Ported from the artifact's Badge card. Tabs, the sidebar and the notification inbox show counts with it.

## Use

```tsx
<Badge count={12} />
<Badge count={3} tone="accent" label="unread" />
<Badge count={240} />  // 99+
<Badge count={10_000} max={Infinity} isAtLeast label="people" />  // 10,000+
<Badge text="New" />
```

- `count` is formatted in the provider's language; over `max` (99) it shows `99+`.
- For a total (a table's record count beside its title), pass `max={Infinity}`: uncapped, so 12,480 reads as itself.
- `isAtLeast` says the count is a floor, not the total: a capped count (a filtered view past 10,000) reads "10,000+".
- `text` puts a short label in place of a count (a grid row's note, "New"). Past the room it has it truncates with an ellipsis; the full text stays in the DOM, so it is read whole.
- `isWhole` (with `text`) keeps a label too short to cut whole ("You" beside a member's name): the badge never shrinks, so the name beside it truncates instead. Why a variant: on a phone the Members table cut "You" to "Y…" (22 October 2026).
- `size="chip"` gives a Badge a Tag's height (22, `space-20` and `space-2`) for a row of chips: the calendars a booking page checks for conflicts, each named with its colour's dot, the long ones ending in an ellipsis.
- `size="chip-lg"` is the prototype's default tag (26, `size-control-sm` less `space-2`), in the small body's strong words: a chip read on its own rather than beside a name (a dish's allergens on its sheet, 28px at 13px inside the guest menu, checklabs' allergen chips).
- `size="fit"` is as tall as its words, 4px over and under: a label inside a line of small type whose words the line sets (the guest menu's table in its eyebrow, where the eyebrow sets 11px semibold capitals, checklabs' table chip).
- `isRound` makes it a pill, `space-8` at its sides (`space-12` on `chip-lg`): a guest page's labels, after checklabs' pills (the guest menu's table, a dish's marks, Popular, Sold out and allergens). Why variants and not a new component: each is still a short label on a fill that truncates or stays whole the same way; only its height, its corners and its words' colour change (the owner wants checklabs' menu exactly, 5 November 2026).
- `tone="strong"` puts the label in the text colour on the neutral fill, where the label is the content rather than a count beside it (a guest page's tags: checklabs' ink on cream).
- `dot` (with `text`) puts a state's dot before the label: `green` working (a calendar's Connected, a job's Done), `blue` under way (Syncing, Running), `orange` needs you (Expired), `red` broken (Failed). Why a Badge variant: a system state isn't an attribute value, so StatusDot (the status attribute's one display, through AttributeDisplay) isn't for it, and a plain grey label hid whether anything was wrong (the owner, 21 October 2026). A calendar's own colour may ride the dot too, where the Badge names that calendar (a booking page's "Checks for conflicts in"): there the label is the calendar's name, never a state word, so the hue reads as the calendar's, as it does on the week.
- `icon` (with `count`) puts a glyph before the count, small and quiet: a comment mark on a table row's name and a board card, "💬 3" for three open threads. Name what is counted with `label` ("open comment threads"), since the glyph is hidden from screen readers. Why a Badge variant: a count with a glyph is still a small count beside a name, and a second chip would repeat its size, colour and number formatting (the CRM flow pass, 31 October 2026).
- `tone`: `neutral` (the default) beside a label, `accent` for counts that ask for attention, `strong` for a label that is the content (above).
- `label` names what is counted for screen readers ("3 unread"); leave it out when the label beside it already says.

## States

None of its own.

## Keyboard

It takes no focus.

## Differences from the artifact

- `count` is a number, not children, so it formats in the viewer's language and caps at `max`. A label goes in `text`, a string, never markup.
- `tone="accent"` replaces the `ws-badge-accent` class.

## Timefix prototype (spec 0072)

Folded into the prototype's Tag (spec 0072): a count is the prototype's `Count`, a round 20px pill in tabular figures, grey (`neutral`) or blue (`accent`, `tag-blue-*`); a label is a Tag's chip.

**Differences from the prototype**: `accent` was a solid accent fill and is now the prototype's blue tint, since blue fills are for selection. `strong`, the `chip`, `chip-lg` and `fit` sizes, `isRound`, `dot`, `icon` and `isAtLeast` are kept. The prototype's ink count is not a tone yet.

**Repeats from its replacer** (spec 0072, AC-4): the dot and its nine hues, as StatusDot draws them; they leave with this export.
