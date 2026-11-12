Checkboxes, radios and switches set a yes/no or one-of-few choice.

**Use it for**: `Checkbox` for an independent yes/no that saves with its form, and for row selection (with indeterminate for "some"). `round` marks a task done. `RadioGroup` + `Radio` for one of two to five visible options (more: Select). `Switch` for a setting that takes effect at once, so no Save button follows it.

**The consumer provides**: the label (clickable, 8px from the control), `isSelected`/`onChange` or a default, `isInvalid`, `isDisabled`; RadioGroup takes `label`, `value`, `orientation`.

**States**: rest, hover (outline darkens), pressed (box 0.9), focus-visible ring, selected (`accent` fill), indeterminate (dash), invalid (`danger` outline), disabled.

**Interaction**: Space toggles; arrows move between radios. The tick draws itself (160ms, 40ms after the fill); a done task's label greys and strikes through; the radio dot scales in; the switch thumb stretches while pressed and slides 16px.

**Replaces**: Checkbox, Radio, Switch.
