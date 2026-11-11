Onboarding is first run: a full-screen split: what you book (Meetings, Appointments or Tables), then a few short steps on the left and a live preview of the workspace on the right that changes as you type.

**Use it for**: the one setup after someone's first sign in. It asks only what the product needs (what you book, name, booking link, the first meeting, service or table settings, hours, calendar for meetings and appointments, team or staff), never a questionnaire. **Don't use it for**: later edits (each lives in Settings) or setting up one booking page (use StepDialog).

**The consumer provides**: `account` and `owner` (the person who just signed in: `nameFromEmail` gives a name from a new address), `checkSlug(slug)` resolving `true` when the link is free, `onFinish(values)`, `onSignOut` (runs after a confirm dialog), `defaultValues`. `onFinish` gets `kind` too, and `party` for a restaurant. `WorkspacePreview` is exported on its own: `workspace`, `slug`, `owner`, `hours`, `invites`, `kind`, `party`, and `focus` to ring the part the step changes.

**States**: each step, link checking / free / taken, hours invalid (end before start), finishing, signed out (asks first).

**Interaction**: "Step 3 of 7" over a thin segment per step (done segments take a press to go back); what you book is a radio group of three cards (arrows move the pick); Enter continues; Back and Continue at the foot, the last reading "Send 2 invites and finish" or offering "Skip for now". Steps slide side by side (transitions.dev 08) and each heading reveals as it arrives (18). The link is checked 350ms after typing stops. Adding a team row grows the step with its content, so nothing below jumps. Hours read "9:00 AM to 5:00 PM" in one row. In the preview the ring eases to the part being edited, closed days are hatched, the hours line crossfades (04) and new teammates pop in on the bounce curve.

**Replaces**: WorkspacePreview, the first run screens.
