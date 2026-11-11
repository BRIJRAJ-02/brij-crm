Steps show where the user is in a flow of three to six steps, and what is done.

**Use it for**: `horizontal` across the top of a multi-step flow (a new booking page, a multi-page form, import mapping). `vertical` down the side of a setup page, with one grey line per step. **Don't** use it for a two-step flow (say "Step 1 of 2"), as navigation between peers (use Tabs), or for a checklist the user can do in any order (use Checklist).

**The consumer provides**: `steps` (id, short label, optional description for vertical), `current` (the index; steps before it are done, `steps.length` means all done), `onStepPress` to let done steps take the user back, and an `aria-label`.

**States**: upcoming (grey ring, grey number), current (blue ring with a soft halo, label in ink, `aria-current="step"`), done (blue disc with a white tick), done and pressable (row washes on hover).

**Interaction**: only done steps are buttons, so Tab visits them and Enter goes back; steps ahead never take focus. A step turning done draws its tick with transitions.dev success check (500ms: rotate, rise, fade and stroke draw) while the connector after it fills blue from the start over 400ms. Reduced motion shows the end state at once.

**Replaces**: Steps, Stepper, the hosted form's step header.
