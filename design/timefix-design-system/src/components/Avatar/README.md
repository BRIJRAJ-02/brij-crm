Avatars stand for a person (round) or a company, workspace or page (rounded square); `PersonLine` pairs one with a name and a grey sub-line, the one way a person or record is drawn in a row.

**The consumer provides**: `name` (always; it is the label and picks the hue), `src` for a photo, `size` (20 inline, 28 rows, 36 lists, 44 headers), `shape`, optional presence `status`. `PersonLine` adds `sub` (email, role, plan, a StatusDot) and an optional `end` slot.

**States**: photo, initials on the name's hue (the same name always gets the same colour), presence dot with a surface ring.

**Interaction**: an `AvatarGroup` fans out slightly on hover (each avatar shifts 8% of its size, 160ms) to show it can be opened; "+3" counts the rest.

**Replaces**: Avatar, PersonLine, the people rows in TeamList, InviteRows and GuestChips.
