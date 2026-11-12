A tooltip is a short ink label that names an icon button or explains why something is disabled, shown on hover or keyboard focus.

**Use it for**: every icon-only button (its name plus shortcut), truncated text, a disabled control's reason. **Don't** put links, buttons or more than one short sentence in it; that is a Popover (InfoTip).

**The consumer provides**: a focusable trigger as the child, `label`, optional `shortcut` (shown as a Kbd), `placement`.

**Interaction**: opens after 500ms of hover or at once on keyboard focus; once one tooltip is open, moving to the next shows it immediately (the group warm-up). Enters 4px from the trigger with scale 0.96 over 160ms; exits in 100ms. Esc closes. An arrow points at the trigger.

**Replaces**: Tooltip, InfoTip's hover form.
