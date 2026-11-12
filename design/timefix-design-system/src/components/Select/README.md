Select picks one option, or several, from a list in a filled field: a stage, a status, a role, a currency, a record's tags.

**Use it for**: `Select` for one choice from a short or long list; `MultiSelect` for several (segments, languages). **Don't use it for** two to five visible choices (RadioGroup), actions (Menu), or searching records (ComboBox).

**The consumer provides**: `label`, `items` (`id`, `label`, optional `status` or `hue` for a Tag, `description` for Vercel-style described options, `icon`, `face` to draw the label in a font stack (a font list previews each face in itself), `isDisabled`), `value` / `onChange` (MultiSelect: `values`, `maxVisible`), `optionStyle` (`plain` or `tag`), `placeholder`, `description`, `errorMessage` with `isInvalid`, `isDisabled`, `isLabelHidden`. `onCreate(label)` adds "Create “text”" when the search matches nothing; return the new id to choose it. `searchable` overrides the default (a search above 8 options).

**States**: empty (grey placeholder), chosen, open (white with the accent edge and ring, chevron turned), invalid (red edge and line), disabled, option focused, option picked (accent tick), option disabled, no matches.

**Interaction**: Enter, Space or ↓ opens; arrows move, typing jumps or filters, Enter picks, Esc closes. The list grows from the field (transitions.dev 05). A single pick draws its tick, then the list closes 120ms later; MultiSelect stays open and the field shows the first Tags, then "+n".

**Replaces**: Select, CurrencyPicker, CountryPicker's list (PhoneField keeps its own), the Select and Status field editors' pickers.
