The natural-language condition builder: a rule read as a sentence ("When Stage is Qualified and Deal value is more than $10,000"), each part a pill that opens its picker.

**Use it for**: view filters written out, automation triggers, routing rules, a form question's "Show when". **Don't use it for**: the quick filter chips on a table toolbar (FilterBar) or a formula (FormulaEditor).

**The consumer provides**: `lead` ("When", "Only if"), `attributes` (the field system's Attribute), `conditions` (`Condition`: id, attributeId, operator, value), `onChange`, `conjunction` and `onConjunctionChange`, a group `label`, and `isReadOnly` for summaries. `operatorsFor`, `OPERATOR_LABELS` and `conditionText` are exported.

**States**: filled pills, an unset value (dashed "a value…"), a pill open (stays pressed), operators without a value ("is empty", "is checked"), one condition (no remove), read only (plain words), narrow (lead above the line).

**Interaction**: the attribute pill opens a filterable Menu with type icons; the comparison pill offers only what the type allows; the value pill opens the type's own picker (tags for options, people, dates, a number or text field). Picks tick, then close 120ms later (menu dropdown 05). "and"/"or" toggles every joiner with a crossfade (04). Add condition drops a line in and opens its attribute list once it settles; remove collapses the line (accordion 21).

**Replaces**: Sentence, ConditionRow.
