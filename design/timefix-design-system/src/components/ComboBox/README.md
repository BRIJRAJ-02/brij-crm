ReferencePicker searches records as you type and picks one: the editor for record references, attendees and "Link a record".

**Use it for**: choosing a person or company from many (thousands), where typing is faster than scrolling. **Don't use it for** a fixed list of options (Select) or free text with suggestions you can ignore.

**The consumer provides**: `label`, `search(query)` returning a promise of records (`id`, `name`, `kind` person or company, `sub` line), `recent` for the empty state, `onSelect`, optional `onCreate(name)`, `placeholder`, `description`, `isDisabled`. The caller draws the chosen records (PersonLine rows with an Unlink button in the demo).

**States**: empty and focused (Recent section), searching (spinner in the field, three skeleton rows), results, no matches ("No matches · Create “acme”" as a selectable row, or plain "No matches" without `onCreate`), disabled.

**Interaction**: focusing opens Recent; typing searches; ↑ ↓ move the highlight (a grey wash, the same for pointer and keyboard), Enter picks, Esc clears then closes. The list grows from the field (transitions.dev 05); arriving results fade up out of a small blur (14 skeleton reveal). People draw as PersonLine with round avatars, companies with square ones.

**Replaces**: ReferencePicker, the RecordReference editor, SuggestionList.
