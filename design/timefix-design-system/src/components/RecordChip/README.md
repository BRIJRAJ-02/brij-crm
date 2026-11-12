Small inline references: a record or person as a chip, a website as a link chip, an @mention in text, and a template variable.

**Use it for**: `RecordChip` wherever a related record shows (cells, panels, cards, activity). `LinkChip` for a domain or URL value. `Mention` inside notes and comments. `Variable` in email and message templates. `RecordChipList` for a row of records such as Recently viewed. **Don't use them for** actions (use Button) or for statuses (use Tag).

**The consumer provides**: `RecordChip` takes `name`, `kind` (`person` round avatar, `company` square), optional `src`, and `href` or `onPress`. `LinkChip` takes `href` (the bare domain is shown). `Mention` takes `name`, `href`, `isSelf`. `Variable` takes `name` and `isMissing`. `RecordChipList` takes `label`, `records` and `max`.

**States**: plain, linked (hover, pressed, focus ring), self mention (yellow), missing variable (orange, announced as having no value), overflow "+n" with the rest in a tooltip.

**Interaction**: linked chips are reached with Tab and followed with Enter. In a RecordChipList the hovered chip lifts 4px and grows to 1.05, its neighbours follow at 45% falloff, and on leaving they spring back with the strong bounce (11 avatar group hover).

**Replaces**: RecordChip, LinkChip, Mention, Variable, RecordChipList.
