The top of a record page: who or what the record is, its tags, the actions on it, its stage, and where it sits in the list it came from.

**Use it for**: the full record page and the head of an expanded record. **Don't** use it inside the peek drawer (RecordPanel has its own compact header) or for list rows (PersonLine).

**The consumer provides**: `name`, `kind` (people get a round 44px avatar, companies and deals a rounded square), `sub`, `tags` (`ai: true` shows the AI enriched tag), `onRename`, `isStarred`/`onStarChange`, `onAskAI` with `isAskOpen`, `onEmail`, `moreActions` (MenuItems for the "…" menu, opened in the shared Menu) with `onMoreAction`, or a bare `onMore`, `stage` (a status attribute, edited with the status field), `position` (index, total, previous, next).

**States**: read only name, renaming (filled input with the accent edge), starred, Ask AI open (button stays pressed), first and last record (the matching arrow disables).

**Interaction**: press the name to rename; Enter saves, Esc cancels. The star swaps outline for filled through from .25 scale (icon swap, 250ms). The stage opens the status list. "7 of 70" rolls its digits as you move; K and J are shown on the arrows' tooltips.

**Replaces**: RecordHeader.
