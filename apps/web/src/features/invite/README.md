# invite

Lean (the owner, 21 October 2026): the title names the workspace ("Join Acme"), one line says who invited you and as what (and, signed out, the masked address it was sent to), then the one action; signed out, one quiet line says signing in makes an account.

`/invite/$token` (spec 0031, AC-805 to AC-807): the page an invitation email links to, in the sign in frame, outside any workspace.

## InviteScreen

- **Purpose:** show who invited you where and as what, and let the invited person join.
- **Main task:** Join workspace (signed in), or Sign in to join (signed out), which comes back here after.
- **Leaves out:** creating an account in place (sign in makes one; an invited address may sign up though the list is closed), and domain joins (slice 6). The invite link (AC-818) opens this same page, naming nobody.

Title "Join {workspace}", with who invited you and as what under it. Signed in, the footer says "Signed in as …" and offers Sign in with another address, which signs out, so it asks first in the shared `SignOutDialog` (the owner's rule of 21 October 2026); Cancel changes nothing.

Signed in and ready, one optional field sits over Join workspace (QA N14, the coordinator's call of 23 October 2026): **Your name**, as first run asks it, prefilled with the account's name, else one made from the address (first run starts from the account's name alone and makes the same name when its field is left empty, so the result matches) (`memberNameFor` from `@crm/contracts/member-names`, through `welcome/names.ts`: "jo.smith-1722@…" gives "Jo Smith"). Enter in it joins, as the button does; it stays editable while joining (never disabled, so focus stays there when a refusal comes back; the Form takes no second submit while busy), and the workspace sketch beside it shows the name the team will see. Whatever is there goes with the join, empty too: the server makes it plain as every join does (`joinerName` in core, control characters and line breaks as spaces, at most 80), falls back to the account's name or the made one when nothing is left, and fills the account's own name only while it is empty, as first run does.

States: loading (the split frame with a skeleton), invalid (any expired, revoked, used or unknown link reads the same, before or after Accept), signed out (one line: sign in as the masked address to accept, and signing in makes an account for someone new), signed in, joining (Join workspace spins), refused for another address (the server's sentence with the masked address, and Sign in with another address as the one action), refused otherwise (a full plan, a failure: the server's sentence, with Accept to try again), and a failed lookup (the server's words when it gave any, such as too many lookups, with Try again). Each state's action is a full width large button, as on sign in and first run (design sweep, 22 October 2026). Built from AuthLayout, WorkspacePreview, Callout, Form, Field, Button, ButtonLink and Modal (through SignOutDialog) only.

Sign in prefilling and locking the invited address (AC-807) waits for the sign in redesign: the page knows only the masked address, and SignInForm has no locked field yet. Until then an invited address is let through a closed sign up by the server, and any other address is refused there as before.
