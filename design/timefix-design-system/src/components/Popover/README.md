Popover is the one floating surface every menu, select, date picker and help bubble opens in, and InfoTip is the small (i) that opens a sentence of help.

**Use it for**: `Popover` inside a `DialogTrigger` for a short panel tied to a button (share, notify, a filter). Menu, Select, ComboBox, DatePicker, ColorPicker and IconPicker already render it, so never wrap them again. `InfoTip` beside a label whose meaning isn't obvious (Minimum notice). **Don't use it for** a form with several steps (a Dialog), a hover label for an icon (Tooltip), or help on obvious fields like Name or Email.

**The consumer provides**: `children`; `label` to name non-list content as a dialog; `width` (`content`, `menu` 240 or the trigger's width, `trigger`, `panel`); `placement` (default `bottom start`, flips when there is no room); `triggerRef` + `isOpen` for an anchor that isn't a trigger. InfoTip takes `label`, one or two sentences, and an optional `href` and `linkLabel`.

**States**: closed, opening, open, closing. The (i) washes on hover and stays washed while open.

**Interaction**: Esc or a press outside closes and focus returns to the trigger; Tab moves through the content. Motion is transitions.dev 05 menu dropdown: it grows from the trigger's anchor point, scale 0.97 to 1 over 250ms, and leaves to 0.99 with a fade over 150ms. Reduced motion shows and hides it at once. Opened inside a themed guest page (a `LookContext` from lib/look.ts: the menu, business, reservation, link and form pages), it wears that page's look: its theme and token overrides, so a dark menu's picker opens dark.

**Replaces**: Popover, InfoTip.
