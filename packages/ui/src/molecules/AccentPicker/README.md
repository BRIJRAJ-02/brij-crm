# AccentPicker

Any colour, picked by sight (spec 0060, AC-3, AC-6): the brand kit's accent in Settings › Brand and a link page's own colour in its Design panel.

## Why it exists

New (31 October 2026). HuePicker picks one of the library's nine names, which is what an option or an object's tile should take; a brand's accent is any colour at all, kept as a checked hex. Bending HuePicker to hold a free value would have given every option editor a hex field it must never have, and no other control in the library picks a colour. So this is its own molecule, built on HuePicker's swatch size, its radio group (the arrow keys move between swatches) and its hue names, with the library's Field for the hex.

## Anatomy

- **The default** first, named by the caller ("Workspace", "Timefix"), drawn in the colour it stands for (`defaultValue`, else the product's accent).
- **Quick picks**: the hues the caller offers (`quickPicks`, a hue and its hex), named by HuePicker's own words.
- **Any colour**: a swatch button that opens the system's own colour picker. A button rather than one more radio, so the arrow keys never open the picker on their way past. It wears the colour once it holds one that isn't a quick pick. While the picker is dragged `onPreview` hears each colour; `onChange` hears the one it settles on.
- **Hex**: the colour as six digits, committed on Enter or leaving the field; empty goes back to the default, anything else that isn't a hex is refused with one line ("Use a colour like #1f5fd6."), never echoing what was typed. `hexPlacement="inline"` puts it at the end of the swatches' row as a small (`sm`) field, the swatches taking the control height so the row is one height; the row wraps whole onto a second line where it doesn't fit. For a short picker beside a preview (a form's embed button colour, the owner, 5 November 2026: the hex alone under the row read as orphaned). Why a prop: the same picker and the same field, only placed; settings keep the hex under the row.
- **`hexPlaceholder`** is what the empty field shows in place of the example: the Design page's four colours show the hex each draws now, since four fields of the same blue read as four blue colours (5 November 2026). Why a prop: only the caller knows the default is a colour on screen rather than a stand in; the brand kit keeps its example.
- **The guard's line** (`drawn`): when the contrast guard moved the pick noticeably, the two colours the page draws (light and dark) and "Adjusted so text stays readable." in one line, read out as it appears.

A swatch's colour is the one value handed in, as `--swatch`, and only a checked hex reaches it; everything else is tokens.

**ContrastBadge** says a picked colour's contrast beside it, a StatusDot and the words ("AA 12.1:1", "Fails AA 2.1:1"), for the Design page's four colours. Why an export: a screen may not draw a StatusDot itself (lint keeps attribute values to the field set), and this isn't an attribute value; it is the picker's own verdict. Story: `Contrast`.

## States

Default chosen, a quick pick chosen (ticked and ringed, the tick black or white by the swatch's luminance so it shows on a pale colour), any colour chosen, a refused hex, adjusted, read only (the colour as text beside one swatch, its quick pick's name with the hex, and no swatch, button or field that would announce as a control a member can't use) and disabled. Nothing moves on press (house rule). `children` sits under the hex on the picker's own left edge: the Dark colour disclosure.

## Keyboard

Tab reaches the group (the arrows move between its swatches), then Any colour, then the hex.

## Differences from the artifact

Not in the artifact yet; it goes with the next `pnpm ui:artifact`.
