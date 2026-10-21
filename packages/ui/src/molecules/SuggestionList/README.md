# SuggestionList

The rows to pick from under what is being typed: members after `@`, blocks after `/`.

## Why it exists

New with the note editor (spec 0019), as `editor/SuggestionList`. It moved here when the comment composer (spec 0038) needed the same `@` rows: the main entry may never reach the editor's chunk (`editor/entry.test.ts`), and a second list would be a second look for one element. Menu doesn't fit, since focus stays in the text field while the list is open.

## Use

```tsx
<SuggestionList
  anchorRef={field}
  id={listId}
  label="Members"
  rows={rows}
  activeIndex={active}
  emptyText="No one matches"
  onPick={pick}
  onHighlight={setActive}
/>
```

- The field keeps focus and names the open list with `aria-controls` and the highlighted row with `aria-activedescendant` (`suggestionOptionId(listId, index)`).
- A row holds a `leading` Avatar or icon, its `label`, an optional `detail` (a member's email) and an optional `hint` keycap (a block's markdown).
- With no rows it is a status line (`emptyText`), never a listbox with no options.

## States

Rows with one highlighted, the pointer over a row, and empty (searching, or nothing matches). It opens instantly from the keyboard, inside the library's non modal Popover.

## Keyboard

The field owns the keys: Up and Down move the highlight, Enter or Tab pick, Esc closes. A pointer press picks without taking focus from the field.
