# System

## `/status` (SystemStatusScreen)

- **Purpose**: prove the stack boots, from the page through the API to Postgres.
- **Main task**: show whether the API and the database answer.
- **Leaves out**: navigation and sign in; it is open to anyone. It lived at `/` until spec 0005 gave `/` to signing in. Its title, and its tab's, is "System status".

## Not found (NotFound)

- **Purpose**: an address the app has no page for.
- **Main task**: say so, and offer the way back to the start (`/`: the workspace when signed in, sign in when not, so the link names neither).
- **Leaves out**: guessing what was meant.
