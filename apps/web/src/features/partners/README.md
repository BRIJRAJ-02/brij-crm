# partners

Partner connect (spec 0070, slice 2): the OAuth connect page an outside app opens, Settings › Workspace › Connected apps, and the operator console's Partners page.

## ConnectScreen

`/oauth/partner/authorize` (AC-7011, AC-7012), outside any workspace, in the sign in frame. Signed out, sign in (or sign up) comes back with the same request.

- **Purpose:** an outside app asks to connect one workspace.
- **Main task:** see who is asking and exactly what it may do, pick a workspace you own (or name a new one), tick its modules, and Connect.
- **Leaves out:** workspaces you don't own (counted, not offered), managing people (the app does that), and settings.

The partner's logo above the title; one Callout with the exact list of what it may do, which follows the modules ticked; the owned workspaces as a RadioGroup with A new workspace last (and its name Field); a Checkbox per module; Connect full width; Cancel in the footer (back to the app with `error=access_denied`). A request the server refuses (an unknown app, an address it didn't register, no state, no S256) shows `ConnectRefused` with the server's words and never sends the browser anywhere.

## ConnectedAppsScreen

Settings › Workspace › Connected apps (AC-7013), owners only (`connected_apps.manage`).

- **Purpose:** the outside apps connected to this workspace.
- **Main task:** see each app, what it may use, when it connected and its last call; change its modules; disconnect it.
- **Leaves out:** connecting (it starts from the app's button), the people an app added, and its call log.

A Table: the app (its logo, square, and its name), its modules as Badges, Approved by, Connected, Last call, then Change and Disconnect; on a phone, two lines a row. Change opens a form Modal with a Checkbox per module (at least one). Disconnect asks first in a danger confirm Modal (an ending action); the row goes at once and the toast says so; a refusal puts the row back and stays in the dialog with its words.

## PartnersScreen

Settings › Super admin › Partners (AC-7010), super admins only.

- **Purpose:** the outside products allowed to connect workspaces.
- **Main task:** register a partner, copy its client id and its secret (shown once), and later edit it or replace the secret.
- **Leaves out:** the workspaces each partner connected, billing, and deleting a partner.

A Table (name, client id, the secret's last four, registered, Edit and Replace secret). Register and Edit share a form Modal: name, logo (FileDrop row), redirect addresses and frame origins, one a line. The client id and secret show once in a Modal with Copy that only Done closes (no Escape, no outside click). Replace secret asks first in a danger confirm Modal: the old one stops at once.
