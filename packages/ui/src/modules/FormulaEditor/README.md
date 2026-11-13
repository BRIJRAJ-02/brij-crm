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

## Timefix prototype (spec 0072)

Takes its look from the parts it is made of, already in the prototype's look: Field's filled box (multiline, `isVerbatim`, so the formula keeps its spacing), white with the `accent-text` edge and `accent-border` ring while typed in and the danger edge on an error, its hint or error line under it (the error fading in as Field's does), and SuggestionList under the field for the suggestions (each row with its type's icon, its label and a quiet detail). It has no CSS module and gains none.

**Use it for** a Formula attribute's formula (weighted value, days to close, margins). **Don't use it for** conditions (Sentence, FilterBuilder) or templated text with variables (Variable chips).

**The consumer provides** `value` and `onChange` (the source, attributes written `{{api_name}}`), `attributes` (`{ apiSlug, title, type }`), `check` (`{ result }` or `{ error }`, from `checkFormulaSource`), and `isReadOnly` with `readOnlyReason`.

**States**: empty (the hint says how to name an attribute), valid (what it gives), invalid (the error, with its character), suggesting attributes, suggesting functions, nothing matching, read only. Stories: Empty, Valid, Invalid, Long, ReadOnly, SuggestingAttributes, SuggestingFunctions, PickByKeyboard, EscapeCloses, NothingMatching.

**Interaction**: typing `{{` lists the attributes, a word the functions; Up and Down move, Enter or Tab put the choice in, Esc closes, and focus stays in the field throughout. The check line is said politely as it changes.

**Differences from the prototype**
- No chips: the prototype draws each attribute as an accent chip on a backdrop under a transparent textarea (and an unknown one red with a wavy underline). The library's field is Field's own textarea, so references read as their `{{api_name}}` text; the chips need a backdrop layer in the field, owed to the screen phase that ports the formula dialog (spec 0015 asks for the same, as a "Reads as" line).
- The field is in the body type, not the prototype's 13px mono: Field has no mono size, and the change belongs to Field (a phase 2 merge note if the owner wants it).
- No live result row for a sample record and no help line of functions: `check.result` says what the formula gives in the hint ("Gives a currency amount"). A sample record's value is owed to the screen phase (ComputedSettings' preview table already shows five records' values).
- No Attribute button and no shake on Enter: `{{` opens the attributes, and Enter only picks from an open list (the dialog's ⌘↵ submits).
- `@` does not list attributes (`{{` does, as the formula language writes them).
- The suggestions open with SuggestionList's own motion (a phase 2 part), not the prototype's menu dropdown.
