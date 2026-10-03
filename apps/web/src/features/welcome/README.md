# Welcome

Spec 0005, milestone 1 (AC-30).

## `/welcome` (WelcomeScreen)

- **Purpose**: a signed in person without a workspace makes their first one.
- **Main task**: confirm your name, the workspace's name and its web address, then Create workspace, which opens People.
- **Leaves out**: invites, templates and workspace settings (#23); someone who already has a workspace is sent to it.

## Notes

- "Your name" starts from the account's name. The workspace name follows it ("Ada’s workspace") until edited, and the web address follows the workspace name (`slugFrom`: lowercase letters and digits in single dash runs, 3 to 40 characters) until edited. Typed, the address turns lowercase and spaces become dashes (`addressAsTyped`).
- The workspace id is a UUID v7 minted once per visit (`data.workspaces.newId()`) and sent again on every try, so a retry after a lost answer makes nothing twice.
- Refusals land on their fields through Form's `fieldFor`: `SLUG_TAKEN` on the web address (the API names the field), input problems by their path, anything else above the fields. A refusal goes as soon as its field's value changes, typed or following "Your name" (Form drops it, and it stays dropped until the next answer), so the screen keeps no copy of its own. The address hint steps aside while the address shows a refusal (Field puts the refusal in the hint's place).
