# invite

`/invite/$token` (spec 0031, AC-805 to AC-807): the page an invitation email links to, in the sign in frame, outside any workspace.

## InviteScreen

- **Purpose:** show who invited you where and as what, and let the invited person join.
- **Main task:** Accept invitation (signed in), or Sign in to accept (signed out), which comes back here after.
- **Leaves out:** creating an account in place (sign in makes one; an invited address may sign up though the list is closed), and the invite link and domain joins (slice 6).

States: loading (the frame with a skeleton), invalid (any expired, revoked, used or unknown link reads the same, before or after Accept), signed out (the masked address, and that signing in with it makes an account for someone new), signed in, joining (Accept spins), refused for another address (the server's sentence with the masked address, and Sign in with another address as the one action), refused otherwise (a full plan, a failure: the server's sentence, with Accept to try again), and a failed lookup (the server's words when it gave any, such as too many lookups, with Try again). Built from AuthLayout, EmptyState, Callout, Button and ButtonLink only.

Sign in prefilling and locking the invited address (AC-807) waits for the sign in redesign: the page knows only the masked address, and SignInForm has no locked field yet. Until then an invited address is let through a closed sign up by the server, and any other address is refused there as before.
