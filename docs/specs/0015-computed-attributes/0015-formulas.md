# 0015. The formula language and its editor

## Summary

A formula is a short expression over one record's own attributes: `{{value}} * {{probability}} / 100`, `IF({{stage}} = "Won", "Closed", "Open")`, `DAYS({{close_date}}, DATE({{created_at}}))`. It is checked as you type, so you see its result type or the first mistake, then stored as a parsed tree beside its text. The same pure functions in `packages/contracts/src/formula/` parse, check and evaluate it in the browser and on the server. There is no clock in the language, so a formula's value changes only when the record does.

## Where the code lives

| Path | Owns |
|---|---|
| `packages/contracts/src/formula/lexer.ts`, `parse.ts` | `parseFormula(source)`: tokens, then a `FormulaNode` tree, or the first error with its position |
| `packages/contracts/src/formula/check.ts` | `checkFormula(tree, attributesBySlug)`: resolves references, infers every node's type, returns the result type or the first error |
| `packages/contracts/src/formula/evaluate.ts` | `evaluateFormula(tree, values, labels)`: the value, or empty |
| `packages/contracts/src/formula/functions.ts` | `FUNCTIONS`: each function's name, argument types and result rule, with its one line description for the editor |
| `packages/contracts/src/formula/decimal.ts` | exact decimal arithmetic on `bigint` |
| `packages/ui/src/modules/FormulaEditor/` | the editor (library module) |

## Syntax

- **Numbers**: digits with an optional decimal part (`1200`, `0.25`); no exponent. A minus sign is the unary operator.
- **Text**: in double quotes, with `\"` and `\\` as the only escapes (`"Won"`). `""` is empty text.
- **Yes and no**: `true`, `false` (any case).
- **References**: `{{api_slug}}`, an attribute of the same object by its API name (which never changes, spec 0012).
- **Functions**: a name (letters and `_`, any case) followed by arguments in parentheses, separated by commas.
- **Operators**, loosest binding first: comparisons `=`, `!=`, `<`, `<=`, `>`, `>=` (not chained: `a < b < c` is an error); `&` (join as text); `+`, `-`; `*`, `/`; unary `-`. Parentheses group. Spaces and line breaks are ignored.

## Types

| Formula type | Comes from |
|---|---|
| number | Number and Rating attributes; number literals |
| currency | Currency attributes (amount and code) |
| text | Text, Long text, Email, URL, Domain, Phone (E.164), Personal name (the full name), and single Select and Status (the option's label now); text literals |
| date | Date attributes |
| timestamp | Created at and Updated at |
| yes or no | Checkbox attributes (unchecked is no, never empty); `true`, `false`; comparisons |
| empty | `BLANK()`; fits wherever any type fits |

A computed attribute is referenced as its result type. Attributes that hold several values, Member, Location, File, Interaction and record references can't be referenced: "Formulas can't use <Type> attributes yet." (or "…attributes that hold several values yet.").

The whole formula must give a number, currency, text, date or yes or no, stored as Number, Currency, Text, Date or Checkbox. A currency result's attribute takes as its `config.defaultCurrency` the first referenced Currency attribute's (in source order), else the code of the first `CURRENCY()` literal, else the formula is refused "Give the result a currency with CURRENCY()." (422 `CONFIG_INVALID`). Each stored value keeps the code its evaluation gave. A timestamp result is refused "A formula can't give a date and time yet. Use DATE()."; a formula that can only give empty is refused "A formula must give a value."

## Operators

| Operator | Operands | Result |
|---|---|---|
| `+`, `-` | number and number; currency and currency | number; currency (codes must match when evaluated) |
| `+`, `-` | date and number (whole days) | date |
| `-` | date and date | number (days, first minus second) |
| `*` | number and number; currency and number (either order) | number; currency |
| `/` | number by number; currency by number; currency by currency | number; currency; number (codes must match) |
| unary `-` | number; currency | the same |
| `&` | any and any | text (each side through `TEXT`) |
| `=`, `!=` | two of the same type (number with number, currency with currency, text with text, date with date, timestamp with timestamp, yes or no with yes or no) | yes or no |
| `<`, `<=`, `>`, `>=` | number, currency, text, date or timestamp, both the same type | yes or no |

Any other pairing is a check error: "Can't <add, subtract, …> <type> and <type>."

Text comparisons ignore case (`"won" = "Won"` is yes) and use one collator in Node and in the browser: `new Intl.Collator('und', { sensitivity: 'accent' })` (the root locale; equal when `compare` gives 0, ordered by its sign), never Postgres. Postgres orders the stored sort keys with its own ICU build, so a formula's `<` between two texts may disagree with the order a sort on those texts shows in a table; that is accepted, and the FormulaEditor's README says so.

## Empty values

- An empty input stays empty through `+`, `-`, `*`, `/` and unary `-`.
- `&`, `CONCAT` and `TEXT` treat empty as `""`.
- `=` and `!=`: empty equals empty (and `""`), and nothing else.
- `<`, `<=`, `>`, `>=` with an empty side give empty.
- Where a yes or no is needed (`IF`'s condition, `AND`, `OR`, `NOT`), empty counts as no.

## Functions

| Function | Arguments | Gives |
|---|---|---|
| `IF(condition, then, else?)` | yes or no; two values of one type (or empty) | that type; `else` defaults to empty |
| `AND(a, b, …)`, `OR(a, b, …)` | 1 to 10 yes or no | yes or no |
| `NOT(a)` | yes or no | yes or no |
| `ISBLANK(x)` | any | yes or no |
| `BLANK()` | none | empty |
| `COALESCE(a, b, …)` | 2 to 10 values of one type | the first that isn't empty |
| `ROUND(x, digits?)` | number or currency; a whole number literal 0 to 4 (default 0) | the same type, half away from zero |
| `ABS(x)` | number or currency | the same type |
| `MIN(a, b, …)`, `MAX(a, b, …)` | 1 to 10 numbers, or 1 to 10 dates | the same type, ignoring empties (all empty gives empty) |
| `AMOUNT(x)` | currency | number |
| `CURRENCY(x, "CODE")` | number; a text literal in `CURRENCY_CODES` | currency |
| `LEN(t)` | text | number (characters) |
| `UPPER(t)`, `LOWER(t)`, `TRIM(t)` | text | text |
| `CONTAINS(t, part)` | text, text | yes or no (ignoring case) |
| `CONCAT(a, b, …)` | 1 to 10 of any type | text |
| `TEXT(x)` | any | text: numbers as canonical decimals, currency as "USD 1200.5", dates ISO, timestamps ISO in UTC, yes or no as "Yes" or "No" (the converters of spec 0013) |
| `DATE(ts)` | timestamp | date (the UTC day) |
| `DAYS(end, start)` | date, date | number of days, end minus start |
| `ADD_DAYS(d, n)` | date, number | date |
| `YEAR(d)`, `MONTH(d)`, `DAY(d)` | date | number |

An unknown name: "Unknown function <NAME>."; a wrong count: "<NAME> takes <n> arguments." (or "1 to 10"); a wrong type: "<NAME> needs <type> as its <first, second…> argument, not <type>."

## Arithmetic and errors

- Numbers and amounts are exact decimals: `bigint` scaled by 10^12 inside the evaluator, so `0.1 + 0.2` is `0.3`. Division keeps 12 decimal places. The stored result is rounded half away from zero to 4 decimal places.
- Evaluation errors give empty, never a refusal: dividing by zero; currencies with different codes in `+`, `-`, `/`, `=`, or an ordering comparison; a result outside `DECIMAL_LIMITS` (14 digits before the point); `ADD_DAYS` with a fractional count or a date outside the years 1 to 9999; a text result longer than 500 characters.
- A yes or no result stores checked for yes; unchecked for no or empty.

## Checking and storing

- `parseFormula` then `checkFormula` run on every keystroke in the editor (pure, in the browser) and again on the server at create and update. A refusal is 422 `CONFIG_INVALID` with the message and `position` (the character index of the offending token, counted from 0; shown to people from 1).
- Limits (`FORMULA_LIMITS` in contracts): source 2,000 characters ("Keep a formula to 2,000 characters."), 200 nodes ("This formula is too long. Split it into two formula attributes."), 20 distinct references ("A formula can use at most 20 attributes."), nesting 20 deep ("This formula nests too deeply.").
- Stored as `{ kind: 'formula', source, ast }`: `source` keeps `{{api_slug}}` references for editing; `ast` holds attribute ids, so evaluation never looks a slug up. A reference to an archived attribute is a check error ("{{slug}} is archived."), and archiving a referenced attribute later makes the formula broken (spec index, AC-327).
- `computed_inputs` gets each reference as `same_record`, and each Select or Status reference also as `option_labels`, so renaming one of its options refills the formula's values.

## Evaluation in the write

`evaluateFormula(ast, values, labels)` takes the record's values after the write (decoded, by attribute id) and `labels` (option id to label for the referenced Select and Status attributes, from the definitions the write already loaded). Formulas of one object are evaluated in dependency order (a formula reading another formula after it), each result passed on to the next, then written by `writeComputed`. A formula reading Updated at sees the record's new `updated_at` (the write's `now()`).

## The FormulaEditor (library module)

- Built on Field (multiline, with the `code` text style from the Code atom), Menu and the Variable atom; presentational, props in and callbacks out (`value`, `onChange`, `attributes` (title, API name, type icon, usable or the reason not), `check` (the result type or the error with its position), `preview` slot).
- Typing `{{` opens a searchable Menu of the object's attributes (icon, title, API name; ones that can't be used are shown disabled with their reason); Enter or Tab inserts `{{api_name}}`, Escape closes. Typing letters at the start of a word opens the functions that start with them, each with its signature and description from `FUNCTIONS`; choosing one inserts `NAME(` and places the caret inside.
- Below the field: "Reads as" renders the formula with each reference as a Variable chip showing the attribute's title, so a person reads titles while the text keeps API names; then the check line: "Gives a <type>" in the success text, or the error ("Unknown attribute {{stage_x}} at character 12.") in the danger text, with the error's character underlined in the field.
- Fully keyboard operable: the Menu follows React Aria's Autocomplete keyboard model; the check line is a polite live region.
- Stories for empty, valid, each error kind, long formulas and disabled references; README; the three browser tests, axe and a screenshot; `design-system-guardian`; artifact publish.

## Tests

- The table driven test: every operator on every type pairing it allows (and a sample it refuses), every function with typical, empty and error inputs, exact decimals (`0.1 + 0.2`, division to 12 places, rounding half away from zero at 4), currency mismatches and the currency result rule, text comparisons ignoring case through the one collator, nesting and size limits, and positions of errors.
- Parse, check and evaluate agree in the browser and in Node on the same samples (one shared test file run by both Vitest projects).

## Rationale (short)

A small language of our own, checked against the object's own attributes, is the only way to give people a typed answer while they type and to run the same thing on the server without running their code. A closed tree with a fixed interpreter can't reach anything but the record's values. Exact decimals matter because formulas will compute money. Leaving out the clock keeps every value stable between edits, which is what lets the database sleep.
