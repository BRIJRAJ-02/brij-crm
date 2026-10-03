# 0005. The screens of the core loop

## Summary

Five screens, met in this order: sign in, verify the code, name your workspace, the app frame, and the People table with its two dialogs (new person, add attribute). Every one is built from the component library and tokens. The sign in pieces and a Form building block move forward from the library's deferred milestone 4, thin and presentational, with stories and reviews like every other component.

## Routes (`apps/web/src/routes`)

| Route | Screen | Guard |
|---|---|---|
| `/` | redirects: signed in with a workspace → its People table; signed in without → `/welcome`; signed out → `/sign-in` | none |
| `/sign-in` | AuthLayout + SignInForm: email, "Continue" (sends the code), "Continue with Google" (text only, hidden without Google), the closed sign up message | signed out |
| `/verify` | AuthLayout + VerifyEmail: "We sent a code to x", CodeInput (verifies on complete), "Send a new code" (60 second wait), "Use another email" | a pending email |
| `/welcome` | AuthLayout + Form: workspace name (prefilled), web address (derived, editable), "Create workspace" | signed in |
| `/w/$slug` | AppShell + Sidebar: workspace name with a menu holding "Sign out", Records section with People (its icon and colour tile), ThemeSwitch in the footer | signed in and a member, else `/sign-in?redirect=…` or NotFound inside the frame |
| `/w/$slug/objects/$object` | TopBar (object name, icon, "New person"), ViewBar ("All people", "Add attribute"), the lazy DataGrid | as above |
| `/status` | the existing status screen (moved from `/`) | none |

Object URLs are generic (`objects/$object`, with `people` as the API slug), so custom objects (#13) reuse them.

## Library work (`packages/ui`, before the screens)

- **Form** (molecule, new): React Aria `Form`, submit on Enter, server errors mapped to fields by name, a field stack at the spacing token. Why new: nothing in the library maps server errors to fields.
- **AuthLayout**, **SignInForm**, **VerifyEmail** (modules, from the inventory's deferred milestone 4): presentational only (props in, callbacks out), every state (idle, sending, error, disabled, closed sign up, resend waiting).
- **Field set registry**: a human label per attribute type, for the type picker.
- Each: README with why it exists, a story per state, `design-system-guardian`, then the artifact publish (`pnpm ui:artifact`, published on your OK).

## The People table

- Columns: every non system People attribute by position, then created at; widths from the field set's `columnWidthOf`. Reference (company) and member cells display only in this loop.
- DataGrid fed by the view's `RowSource`; `onCellChange` and `onCellsChange` call `data.records.setValue`; `cellErrors` and `status` and `onRetry` come from the view.
- "New person": Modal + Form with the Name (personal name) and Email editors (`surface='form'`). On create the row scrolls into view and takes focus; refusals show on their fields.
- "Add attribute": Modal + Form with a name Field and a type Select (the eight no setup types, each with its registry icon and label); "Create" shows busy until the server answers; refusals inline.
- Empty: EmptyState with "New person". Loading: the grid's skeleton. Error: the grid's error with Retry. Live paused: a quiet Callout above the grid.

## Every screen

- A three line brief (purpose, main task, what it leaves out) in its feature folder's README.
- Focus moves to the page title on route change; full keyboard use; contrast in light and dark.
- `dxe quick`, `ux-interaction-reviewer` and `design-system-guardian` before each milestone lands.
- The grid stays lazy; the first load stays under 250 kB.

## Rationale (short)

Dialogs for create and add attribute reuse form editors that exist and leave the grid, the library's riskiest module, unchanged. Pulling the auth modules into the library keeps the rule that screens are assembled only from library parts, at the cost of a little library work before the first screen.
