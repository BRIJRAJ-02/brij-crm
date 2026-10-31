# automations

Settings › Automations (parity #53): "when X, if Y, do Z".

## AutomationsScreen

- **Purpose:** what the workspace does for itself, and a log of what it did.
- **Main task:** switch an automation on or off, add one from a starter chip, change it as a sentence, read the last 50 runs.
- **Leaves out:** branches, delays, email and AI steps, a page per run, re-running a run.
- It needs `automations.manage` (the loader answers "not found" without it; the navigation and ⌘K leave the page out). A row has a Switch, one line saying what it does, why it turned itself off (a few words), who it runs as, and a menu (Edit, Delete). Delete is one click and the toast says Undo; nothing asks first. The count and the New automation button stop at 50 with the reason.
- Live: the held list and log (`data.automations.open`) read again on an `automations` event, so a run finishing and an automatic switch off appear in every tab.

## AutomationDialog

- **Purpose:** build or change one automation as a sentence.
- **Main task:** pick a starter (a new one) or change the blanks, then Turn on or Save.
- **Leaves out:** a name (the sentence is the name), conditions through relations, branches.
- The blanks are the library's inline Selects and small Fields inside `Sentence`; a set field's value is the field set's own editor; conditions are the filter builder behind "Only if", this record's own fields only. Turn on and Save stay off until every blank is filled (`toDefinition` in `model.ts`). Whoever saves or switches it on is who it runs as.

## model.ts

The draft, the starters, `toDefinition`, `draftOf` and `summaryOf`: plain functions, tested in `model.test.ts`.
