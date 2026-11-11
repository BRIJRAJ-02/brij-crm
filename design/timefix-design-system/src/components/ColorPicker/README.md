ColorPicker picks a colour: one of the nine data hues for options, objects and calendars (ColorSwatchPicker), or a booking page's brand colour (AccentPicker).

**Use it for**: `ColorSwatchPicker` wherever data takes a hue, so tags, dots and tiles stay on the token palette; put it in a Popover behind a dot when a row has room for one swatch only. `AccentPicker` for public page branding, where any colour is allowed. **Don't use it for** theming the app itself, or text colour.

**The consumer provides**: ColorSwatchPicker takes `label`, `value` / `onChange` (a Hue), `isLabelShown` (label plus the chosen name), `isDisabled`. AccentPicker takes `label`, `value` / `onChange` as "#RRGGBB", and `swatches` (defaults to seven curated accents that keep white text readable).

**States**: swatch rest, hover (grey ring), chosen (ring in its own colour and a check), focus-visible, disabled. Hex field: typing, focused (accent edge), a hex that doesn't parse returns to the last good colour when you leave the field. A readability line says white text's contrast; under 4.5:1 it turns amber and suggests a darker colour.

**Interaction**: Tab reaches the chosen swatch; arrows move and choose. The check swaps in from 0.25 scale over 250ms (transitions.dev 09 icon swap); nothing moves on press. In a popover, the pick shows its check, then closes 120ms later.

**Replaces**: HuePicker, AccentPicker.

`AccentPicker` takes `use="ground"` for a page's background colour: its line then says whether the page reads light or dark on it instead of white text's contrast.
