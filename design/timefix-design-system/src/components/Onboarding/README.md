Onboarding is first run: a full-screen split with four short steps on the left and a live preview of the workspace on the right that changes as you type.

**Use it for**: the one setup after someone's first sign in. It asks only what the product needs (workspace name, booking link, hours, team), never a questionnaire. **Don't use it for**: later edits (each lives in Settings) or setting up one booking page (use StepDialog).

**The consumer provides**: `account`, `owner` (the host shown in the preview), `checkSlug(slug)` resolving `true` when the link is free, `onFinish(values)`, `onSignOut` (runs after a confirm dialog), `defaultValues`. `WorkspacePreview` is exported on its own: `workspace`, `slug`, `owner`, `hours`, `invites`, and `focus` to ring the part the step changes.

**States**: each step, link checking / free / taken, hours invalid (end before start), finishing, signed out (asks first).

**Interaction**: Steps across the top (done steps take a press to go back); Enter continues; Back and Continue at the foot, the last reading "Send 2 invites and finish" or offering "Skip for now". Steps slide side by side (transitions.dev 08) and each heading reveals as it arrives (18). The link is checked 350ms after typing stops. In the preview the ring eases to the part being edited, closed days are hatched, the hours line crossfades (04) and new teammates pop in on the bounce curve.

**Replaces**: WorkspacePreview, the first run screens.
