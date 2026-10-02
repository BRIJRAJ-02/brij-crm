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
- The attribute picker lists the object's attributes; a relation with `relatedAttributes` opens its own as a submenu, and the condition goes through it (`{ operator: 'through', path, condition }`), shown as "Company › Location".
- Operators come from the field set, in words ("is any of", "is greater than"). Choosing one resets the operand to that operator's shape.
- Operands: the type's editor for one value (a system time edits as a date), two for between, the multi value editor for a list (a status's statuses as a multi select), a range for within (a named range, or an amount of days, weeks, months or years), a Field for text matches, the country picker for "country is", and nothing for bare operators (is empty, is me).
- `displayOf(attributeId, value)` passes record and member names to the operand editors and displays.
- `isReadOnly` shows each condition as a sentence through the field set's displays, with nothing to press.

## States

Empty ("No filters yet", with Add filter), filled, nested, read only. A row missing its operand. Narrow: below `bp-container-md` each row's lead stacks above its controls (container query).

## Keyboard

Tab moves through each row's lead switch, attribute, operator, operand and Remove, then the Add buttons. Menus open with Enter, Space or the down arrow; the attribute menu has a search field, and the right arrow opens a relation's submenu.

## Differences from the artifact

- The card took `conditions` and a top level `conjunction` with `{icon, attribute, operator, value}` rows; the code takes contracts' `FilterGroup` and edits it, with operands by operator.
- Relations through a submenu, read only, and the empty state are new.
