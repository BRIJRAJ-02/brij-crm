# 0041 rationale

## Why no new endpoint

Every section already has a read: Bookings' calendar range, My tasks' list, a records window with a filter, and the capture lists. A Home endpoint that returned everything in one call would be a second path to the same rows: it would need its own access checks, its own live updates and its own caching, and drift from the screens it summarises. Reading through the stores means a task ticked on Home is ticked in My tasks, and a deal edited elsewhere leaves Needs attention live.

## Why this rule for Needs attention

timefix's rule had four states (follow up overdue, no activity, and two more) built on its own deals table. Here a deal is a record of a generic object, so the rule has to be one the records engine can run as a filter: owner is me, stage is open, unchanged for 14 days. It uses only what every Deals object has from the standard template, and it is the same filter a person could save as a view, so the two can't disagree. Considered and turned down: time in stage against a stage's target (`targetTimeInStage`), which needs value history the filter can't read yet; and records with overdue tasks, which repeats Tasks due.

Notes and tasks don't change a record's `updated_at`, so a deal with a recent note can still show. That is honest to the rule as worded ("nobody has changed it") and is the gap a last interaction attribute fills later.

## Why absent and not empty

timefix tried empty states on these cards and the owner removed them. Kept here. The one exception is a page where every section is absent, which would otherwise be a blank page.

## Why a TileGrid

The cards sit side by side and wrap, like timefix's `repeat(auto-fit, minmax(380px, 1fr))`. Screens can't hold CSS, PageColumn stacks, and LinkGrid draws its own cards, so the layout is a small new molecule. The planned Dashboard module (#52) can build on it.
