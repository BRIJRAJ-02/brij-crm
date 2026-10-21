# invite

`/invite/$token` (spec 0031, AC-805 to AC-807): the page an invitation email links to, outside any workspace, in first run's split card (spec 0036): the workspace sketched beside the task (WorkspacePreview, the workspace ringed), no step count, one line and one action.

## InviteScreen

- **Purpose:** show who invited you where and as what, and let the invited person join.
- **Main task:** Accept invitation (signed in), or Sign in to accept (signed out), which comes back here after.
- **Leaves out:** creating an account in place (sign in makes one; an invited address may sign up though the list is closed), and the invite link and domain joins (slice 6).

Title "Join {workspace}", with who invited you and as what under it. Signed in, the footer says "Signed in as …" and offers Sign in with another address, which signs out, so it asks first in the shared `SignOutDialog` (the owner's rule of 21 October 2026); Cancel changes nothing.

States: loading (the split frame with a skeleton), invalid (any expired, revoked, used or unknown link reads the same, before or after Accept), signed out (one line: sign in as the masked address to accept, and signing in makes an account for someone new), signed in, joining (Accept spins), refused for another address (the server's sentence with the masked address, and Sign in with another address as the one action), refused otherwise (a full plan, a failure: the server's sentence, with Accept to try again), and a failed lookup (the server's words when it gave any, such as too many lookups, with Try again). Built from AuthLayout, WorkspacePreview, EmptyState, Callout, Button, ButtonLink and Modal (through SignOutDialog) only.

Sign in prefilling and locking the invited address (AC-807) waits for the sign in redesign: the page knows only the masked address, and SignInForm has no locked field yet. Until then an invited address is let through a closed sign up by the server, and any other address is refused there as before.
