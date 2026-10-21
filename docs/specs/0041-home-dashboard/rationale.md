# 0041 rationale

## Why no new endpoint

Every section already has a read: Bookings' calendar range, My tasks' list and the capture lists. A Home endpoint that returned everything in one call would be a second path to the same rows: it would need its own access checks, its own live updates and its own caching, and drift from the screens it summarises. Reading through the stores means a task ticked on Home is ticked in My tasks, and a deal edited elsewhere leaves Needs attention live. Today is the exception: bookings have no change event yet, so, as on Bookings, Today reads again when the person comes back to the tab, not live.

## Why absent and not empty

timefix tried empty states on these cards and the owner removed them. Kept here. The one exception is a page where every section is absent, which would otherwise be a blank page.

## Why a TileGrid

The cards sit side by side and wrap, like timefix's `repeat(auto-fit, minmax(380px, 1fr))`. Screens can't hold CSS, PageColumn stacks, and LinkGrid draws its own cards, so the layout is a small new molecule. The planned Dashboard module (#52) can build on it.

## Why Needs attention went

timefix removed it, and the owner dropped it on 22 October 2026. Its records layer change (a window on updated at before a past time settling only for its own rows) went with it, since nothing else asks that question.
