AuthLayout is the shell of every page before the app: sign in, verify, join, invite and first run.

**Use it for**: a page whose one task is getting someone in or set up. Pass `preview` for the full-screen left/right split (the task on the left, a calm product sketch on the right); leave it out for a centred card. **Don't use it for**: anything inside the app (use AppShell) or for a dialog's content.

**The consumer provides**: `children` (the task, usually SignInForm or a short form opening with `AuthHeading`), `preview` (`AuthPreview`, or `WorkspacePreview` on first run), `footer` (`AuthFooterLink`s: Terms, Privacy, Help, or Sign out), `account` ("Signed in as …"), `isBusy`. It fills its container, so give it the window's height.

**States**: split, centred card, busy (skeleton lines, `aria-busy`), narrow (below about 760px the preview leaves and the task takes the window).

**Interaction**: only the task takes focus; the preview is `inert` and hidden from assistive tech. `AuthHeading` reveals its title and line as staggered text (transitions.dev 18: 12px rise, 3px blur, 500ms, 40ms apart), and the preview's cards settle in one after another. `AuthPages` slides a task's pages side by side (08: 8px, 3px blur, 250ms) while the box eases to the new height (01 card resize), moves focus to the new page's first field or heading, and replays the heading's reveal on arrival.

**Replaces**: AuthLayout, PreviewLayout's sign in use.
