# FilterBuilder

The advanced filter: rows of conditions joined by and or or, groups nested up to three deep, and paths through relations.

## Why it exists

Ported from the artifact's FilterBuilder card. Every view (#20, #21) filters through one builder, and it holds what contracts define (`FilterGroup`, `FilterCondition`), so a saved view and the filter that runs it agree. Its controls are the library's: Button and Menu for the attribute and operator, the field set's editors on their `filter` surface for each operand, Select for and or or and for ranges, and the country picker. FilterChip stays the toolbar's one line summary of a condition.

## Use

```tsx
<FilterBuilder
  attributes={objectAttributes}
  relatedAttributes={(relation) => attributesOf(relation)}
  value={filters}
  onChange={setFilters}
  editorProps={(attribute) => ({ onSearch: searchMembers, me })}
/>
```

- `value` is a `FilterGroup`. `onChange` hands back every change, conditions still missing their operand included: such a row filters nothing until it has one. Save and run `completeFilters(value)`; `countFilters(value)` is the count a Filter chip shows. Both are exported from `filter-model.ts` with the other pure edits.
- The first row reads "Where"; the second chooses and or or for its group; later rows repeat the word, since one group mixes only one. Mix them by adding a group. Groups nest at most three deep (`MAX_FILTER_DEPTH`).
- Rows share one grid (each a subgrid), so the lead column is as wide as its widest lead. A condition's attribute picker sizes to its name between `7 × size-chip` and `10 × size-chip` (a longer name or path is cut, whole in a tooltip), its operator to its words from `5 × size-chip`, so nothing stretches across the popover (owner item 46, 31 October 2026); an operator is never cut.
- The attribute picker lists the object's attributes; a relation with `relatedAttributes` opens its own as a submenu, and the condition goes through it (`{ operator: 'through', path, condition }`), shown as "Company › Location".
- Operators come from the field set, in words ("is any of", "is greater than"). Choosing one resets the operand to that operator's shape.
- `operatorsOf(attribute)` narrows an attribute's operators to a list (undefined keeps them all), and a new condition starts on the first left: a view with no record search offers a relationship only is empty and is not empty (30 October 2026). Why a prop: only the screen knows which operands it can feed, and a relationship left out altogether had its column's Filter end in a toast.
- Operands: the type's editor for one value (a system time edits as a date), two for between, the multi value editor for a list (a status's statuses as a multi select), a range for within (a named range, or an amount of days, weeks, months or years), a Field for text matches, the country picker for "country is", and nothing for bare operators (is empty, is me).
- `displayOf(attributeId, value)` passes record and member names to the operand editors and displays.
- `isReadOnly` shows each condition as a sentence through the field set's displays, with nothing to press.
- `ConditionChip` is one top level item of a view's filter as a FilterChip, in the builder's own words (spec 0020, the view's Toolbar): its attribute through relations with its type's icon, its operator and its operand through the field set; a condition with no operand has no value part, a group reads "3 conditions", and an attribute the view can't show reads "Unavailable field". Every part calls `onPress` (the screen opens the builder); remove calls `onRemove`. It lives here because only the builder knows how an operator and an operand read, so a chip and its row can't word a condition differently.
- `conditionOn(attribute, operator?)` is a new condition on an attribute with its type's first operator and no operand yet: the column menu's Filter starts one.
- A condition's attribute and operator pickers carry the secondary edge and fill everywhere, a popover included (owner item 44, 31 October 2026: borderless pickers read as plain text). The top group's foot ends with "Clear all" (ghost, with an x) on Add filter's row, one click, shown only while there is a condition to clear. Add filter and Add group are ghost buttons, Add group second with the list's icon, so adding never outweighs the conditions (items 43 and 48). The attribute menu lists the object's own attributes first and system ones (`isSystem`) after, under System (item 47).

## States

Empty (one quiet "No filters yet" line, then Add filter), filled, nested, read only. A row missing its operand. ConditionChip: with a value, without one, through a relation, a group, and an unavailable field (the Chips story). Narrow: below `bp-container-md` each row's lead stacks above its controls (container query).

## Keyboard

Tab moves through each row's lead switch, attribute, operator, operand and Remove, then the Add buttons. Menus open with Enter, Space or the down arrow; the attribute menu has a search field, and the right arrow opens a relation's submenu.

## Differences from the artifact

- The card took `conditions` and a top level `conjunction` with `{icon, attribute, operator, value}` rows; the code takes contracts' `FilterGroup` and edits it, with operands by operator.
- Relations through a submenu, read only, and the empty state are new.
