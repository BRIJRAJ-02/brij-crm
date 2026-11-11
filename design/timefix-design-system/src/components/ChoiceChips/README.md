ChoiceChips pick one or several visible options as pills: a meeting length, what a guest is interested in, a quick filter.

**Use it for**: two to eight short options that should all be seen at once, on guest pages and forms (`md` 36) and app filters (`sm` 28). `selectionMode="single"` acts like radios, `"multiple"` like checkboxes. **Don't use it for** long lists (use a Select or ComboBox), actions (use Buttons), or switching views (use Tabs or a segmented control).

**The consumer provides**: `label` (shown above, or `isLabelHidden`), `items` (`{ id, label, dot?, isDisabled? }`; `dot` takes a data hue), `selectionMode`, `selectedKeys`/`onSelectionChange` (a Set of ids) or `defaultSelectedKeys`, `size`, `isDisabled`, `end` (a Clear button after the chips).

**States**: rest (white, hairline), hover (wash, border darkens), pressed (0.97), selected (ink with a check), selected hover, focus-visible ring, disabled.

**Interaction**: Tab reaches the group; arrows move between chips; Space or Enter toggles. In single mode one stays chosen once picked. A chosen chip turns ink while its check swaps in with transitions.dev icon swap (250ms, from 0.25, the slot opening as it comes; a chip with a hue dot swaps the dot for the check in place.

**Replaces**: ChoiceChips and GuestChips' picking.
