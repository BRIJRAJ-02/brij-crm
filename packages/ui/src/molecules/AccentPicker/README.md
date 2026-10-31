# AccentPicker

Any colour, picked by sight (spec 0060, AC-3, AC-6): the brand kit's accent in Settings › Brand and a link page's own colour in its Design panel.

## Why it exists

New (31 October 2026). HuePicker picks one of the library's nine names, which is what an option or an object's tile should take; a brand's accent is any colour at all, kept as a checked hex. Bending HuePicker to hold a free value would have given every option editor a hex field it must never have, and no other control in the library picks a colour. So this is its own molecule, built on HuePicker's swatch size, its radio group (the arrow keys move between swatches) and its hue names, with the library's Field for the hex.

## Anatomy

- **The default** first, named by the caller ("Workspace", "Timefix"), drawn in the colour it stands for (`defaultValue`, else the product's accent).
- **Quick picks**: the hues the caller offers (`quickPicks`, a hue and its hex), named by HuePicker's own words.
- **Any colour**: a swatch button that opens the system's own colour picker. A button rather than one more radio, so the arrow keys never open the picker on their way past. It wears the colour once it holds one that isn't a quick pick. While the picker is dragged `onPreview` hears each colour; `onChange` hears the one it settles on.
- **Hex**: the colour as six digits, committed on Enter or leaving the field; empty goes back to the default, anything else that isn't a hex is refused with one line ("Use a colour like #1f5fd6."), never echoing what was typed.
- **The guard's line** (`drawn`): when the contrast guard moved the pick noticeably, the two colours the page draws (light and dark) and "Adjusted so text stays readable." in one line, read out as it appears.

A swatch's colour is the one value handed in, as `--swatch`, and only a checked hex reaches it; everything else is tokens.

## States

Default chosen, a quick pick chosen (ticked and ringed, the tick black or white by the swatch's luminance so it shows on a pale colour), any colour chosen, a refused hex, adjusted, read only (the colour as text beside one swatch, its quick pick's name with the hex, and no swatch, button or field that would announce as a control a member can't use) and disabled. Nothing moves on press (house rule). `children` sits under the hex on the picker's own left edge: the Dark colour disclosure.

## Keyboard

Tab reaches the group (the arrows move between its swatches), then Any colour, then the hex.

## Differences from the artifact

Not in the artifact yet; it goes with the next `pnpm ui:artifact`.
