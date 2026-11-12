IconPicker chooses an object's or page's icon from a curated set of Lucide icons, shown on the object's hue.

**Use it for**: object settings, list and page icons, anywhere a saved icon name draws as a tile (`IconTile`). **Don't use it for** uploading a logo (a file field) or choosing emoji.

**The consumer provides**: `label`, `value` (a name from `ICONS`) and `onChange`, `hue` so the grid previews the icon as it will show, `isDisabled`. `IconTile` draws a saved name anywhere else (`sm` 20px in the sidebar, `md` 28px). The curated `ICONS` list carries names, categories and search words, so the bundle never loads all of Lucide.

**States**: trigger rest, hover and open (washed), focus-visible, disabled. Grid cell rest, hover or keyboard focus (grey wash), chosen (accent-soft with a 2px accent ring), no matches ("No icons match"). Category pill rest, hover, chosen.

**Interaction**: the search is focused on open and matches names and words ("food" finds Restaurant). Tab moves to the category pills, then into the grid; arrows move in two dimensions, Enter or a press chooses, the ring lands and the popover closes 120ms later; Esc closes and focus returns to the tile. The surface grows from the tile (transitions.dev 05).

**Replaces**: IconPicker.
