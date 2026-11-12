The checklist walks a new workspace through setup: a few steps, how far along it is, and one action each.

**Use it for**: first-run setup on the home page (connect a calendar, set hours, create a booking page, invite the team) and a "ready to publish" list on a page editor. **Don't** use it for a flow that must go in order (use Steps or a StepDialog), or for more than six steps.

**The consumer provides**: `title`, `steps` (id, verb title, one-line description, 16px icon, short `actionLabel`, `isDone`), `onAction(id)` which opens the step's place (the step is marked done by the data, not the button), `onHide`, and `defaultExpanded`.

**States**: in progress ("2 of 6" and a thin blue bar), open step (icon in a grey round well, title, grey line, soft action), done step (round blue check that draws in, struck grey title, no action, listed after the open ones), all done ("You're all set" with Hide), folded.

**Interaction**: the head is a disclosure button (Enter or Space folds the list); each action is in the tab order. Folding uses transitions.dev accordion on React Aria's measured height (250ms) while the content fades from and the chevron flips. A step that turns done glides to its new place over 350ms instead of jumping; the bar eases to the new share over 400ms.

**Replaces**: SetupChecklist, ReadyPanel.
