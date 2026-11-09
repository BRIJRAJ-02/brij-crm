RolePowers shows what each role may do: roles as columns, powers grouped into folds as rows, a checkbox in every cell.

**Use it for**: Settings › Roles, where an admin reads and changes what Admin, Member and custom roles can do. **Don't use it for**: one person's access (show their role) or a role picker (Select with described options).

**The consumer provides**: `areas` (folds of powers, each with a label and optional grey line), `roles` (`isLocked` for Owner, `isCustom` for deletable roles), `grants` (power ids per role), `onChange(roleId, powerId, isHeld)`, `onAddRole(name, fromRoleId)` to show "Custom role", `onDeleteRole`, `defaultExpanded`, `isReadOnly`.

**States**: folds open or closed, Owner locked on (quieter, a lock in its header and "(always on)" read aloud), a new custom column, read only.

**Interaction**: folds open and close with the accordion motion (transitions.dev 21) and several may be open; the head row shares the panel's grid so cells sit under their role, and the matrix scrolls sideways when roles outgrow the width. Ticking draws the check (25). "Custom role" opens a Dialog (name, start from) and the new column fades in. Deleting a custom role asks first in a ConfirmDialog. Every checkbox is named "Admin: Delete records".

**Replaces**: RolePowers.
