A computed attribute's formula: a mono field where attributes read as chips, with suggestions, a live result and a plain error line.

**Use it for**: formula attributes (weighted value, days to close, margins). **Don't use it for**: conditions (Sentence) or templated text with variables (Variable chips).

**The consumer provides**: `value` and `onChange` (the source, attributes written `{Deal value}`), `attributes` (id, name, type), `sample` (a record's name and numeric values by id), `format` for the result, `label`, and `onSubmit`. `evaluateFormula` is the pure checker and calculator; `FORMULA_FUNCTIONS` lists ROUND, IF, MIN, MAX, ABS and SUM.

**States**: empty (placeholder), valid (result for the sample record), suggesting attributes, suggesting functions, unknown attribute (red chip), invalid (red edge, error with its character), shaking on Enter.

**Interaction**: typing @ (or the Attribute button) lists attributes; a letter lists functions; Up and Down move, Enter or Tab insert, Esc closes, focus stays in the field. The list grows from the field (menu dropdown 05). The error waits for a pause in typing, fades in over 280ms, and the box shakes on Enter (error shake 12). The result crossfades as it recomputes (TextSwap). Chips are drawn on a backdrop under a transparent textarea, their braces acting as padding, so the caret never drifts.

**Replaces**: FormulaEditor.
