# FormulaEditor

A formula typed in a field, for a Formula attribute (spec 0015): `{{amount}} * {{probability}} / 100`.

## Why it exists

New (spec 0015, pulled forward from spec 0003's milestone 4). A formula is text, but people should not have to remember API names or function names, and they need to know at once whether what they typed works. No component held a field that suggests from two lists by what is typed at the caret and says the result under it. It is made of Field (its `combobox`, `onKeyDown` and `onSelect`, as CommentComposer's mentions use them) and SuggestionList, with no CSS of its own.

## Use

```tsx
<FormulaEditor
  value={source}
  onChange={setSource}
  attributes={[{ apiSlug: 'amount', title: 'Amount', type: 'currency' }]}
  check={{ result: 'Gives a currency amount' }} // or { error: 'Unknown attribute {{amt}} at character 1.' }
/>
```

- Presentational: the text, the attributes and the check come in. The screen checks with `checkFormulaSource` from `@crm/contracts/formula`, the same function the server runs.
- Typing `{{` lists the attributes that match what follows (title or API name), each with its type's icon; Enter or Tab puts `{{api_name}}` in, Escape closes the list. Typing a word lists the functions that start with it, with their signature and one line; picking one puts `NAME(` in with the caret inside.
- The check line is the field's hint ("Gives a number") or its error ("Unknown attribute {{stage_x}} at character 12."), and is said politely as it changes.
- Text compares ignore case with one collator in Node and the browser; a table sorts text with Postgres's own, so `<` between two texts may disagree with a sorted column now and then.

## States

Empty (the hint says to type `{{`), valid (what it gives), invalid (the error in the danger tone), suggesting attributes, suggesting functions, nothing matching, read only.

## Keyboard

Focus stays in the field. While a list is open, Up and Down move the highlight, Enter or Tab picks, Escape closes it.

## Differences from the artifact

Not in the artifact. Spec 0015 also asks for a "Reads as" line with each reference as a Variable chip, and the error's character underlined in the field; both are left out for now (the error names its character).
