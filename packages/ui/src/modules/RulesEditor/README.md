# RulesEditor

An attribute's validation rules, in order (spec 0013): each read as the message a broken rule gives, opened in place to its settings, its message and an "Only when…" condition.

## Why it exists

New, for AttributeSettings' Validation section (spec 0013, milestone 1). Nothing in the library held a reorderable list whose rows open into a small form of their own: OptionsEditor's rows are one line of fields each (a label, a colour, a stage's outcome), and a rule needs its kind's settings, a message and a whole FilterBuilder. A variant of OptionsEditor would have carried two different row shapes and two sets of props, so this is its own module, built the same way (a React Aria GridList with drag and keyboard reorder through `lib/reorder.ts`, a row menu, a dashed Add button) and composed of Field, Select, Checkbox, RadioGroup, DatePicker, Disclosure, Menu and FilterBuilder.

## Use

```tsx
<RulesEditor
  label="Rules"
  rules={rules} // RulesEditorRule[]: editorRuleOf(view) for each rule the server gave
  kinds={ruleKindsFor({ type, isMulti })} // from @crm/contracts/validation
  attribute={{ title: 'Reference', type: 'text' }}
  conditionAttributes={objectAttributes} // the object's own, no relatedAttributes
  newId={mintId}
  onChange={setRules}
  errors={{ 'rules.0.max': 'Text holds at most 500 characters.' }}
/>
```

- Presentational: the rules come in, every change goes out as the whole list (`onChange`), and the dialog sends it with Save. `ruleOf(rule)` turns a row into the settings the API takes (bounds as numbers or decimals, lists split on commas, empty ones left out); `editorRuleOf(settings)` goes the other way.
- Each row reads as the message its rule gives when broken: its own message when it has one, else the generated one from `@crm/contracts/validation` (`generatedMessage`, with " when <summary>" after a condition), so the person reads exactly what a refused save will say. A rule whose settings aren't finished reads "<Kind>: finish its settings". The kind's name sits above it.
- A row opens in place (Enter on it, or Edit in its menu): the kind's settings (two bounds for a length, a count or a range; a format with its text or pattern and Ignore case; allow or block and the domains; countries; currencies; a date range's earliest and latest, each none, a date or days from today), the Message (up to 200 characters, with a counter; its hint says everyone who edits the attribute sees it), and "Only when…", a Disclosure holding FilterBuilder on `conditionAttributes` with no `relatedAttributes`, so no condition can follow a relationship. Done closes it. A new rule from Add rule opens with its first setting focused.
- Rows move by drag, by keyboard on the handle (Enter picks up, the arrows choose, Enter drops), or Move up and Move down in the row's menu, which says where the rule went. Delete takes it out, and focus goes to the next rule's menu, or Add rule.
- `errors` are keyed as the server names them, `rules.<index>.<setting>`: a refused setting shows on its field, and refusals arriving open their first rule. A closed row with a refusal shows it under its message.
- `limit` (20) shows "N of 20" and stops Add rule there, with a line saying why.
- `isReadOnly` shows the rules as sentences, a condition as "Only when its conditions are met.", with no handle, menu or Add rule.

## States

Empty (with a line saying any value is accepted, or that the type takes no rules), rules closed, one open, refused (on its setting, or under a closed row), full, read only, dragging, drop target, focus.

## Keyboard

Tab moves into the list and through a row's controls; the arrow keys move between rows. Enter on a row opens it; Enter in a setting never submits the dialog around it. Enter on a handle picks the rule up, the arrows choose where it goes, Enter drops it, Esc cancels.

## Differences from the artifact

Not in the artifact yet (milestone 1 is held from the artifact publish until it is approved).
