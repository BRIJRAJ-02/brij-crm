# PublishBar

The head of a public page's editor (spec 0068, AC-6811, AC-6812): how many changes guests don't see yet, then Changes (the list, each a plain sentence such as "Length 30 min → 45 min"), Versions, Preview, Discard and Publish. Booking pages first; link, business, event and menu pages take the same bar.

## Why a new part

SaveBar is the floating bar for unsaved edits on one screen: it leaves once they are saved. A published page has a second state that outlives the screen: a saved draft guests don't see, its changes, and its versions. Putting that into SaveBar would make one bar mean two things (unsaved here, unpublished for guests), so it is its own strip, built from the library's Button, Menu, Modal, NumberPop and SuccessCheck.

## States

- `live`: nothing to publish. A quiet "Live: guests see this page" and Versions.
- `draft`: a dot, the count (it pops as it changes) and "changes not published"; Changes, Versions, Preview, Discard and Publish.
- `publishing`: Publish keeps its place with its spinner; Discard waits.
- `published`: the check draws and Publish says Published, disabled; the caller puts the bar back to `live` after a moment.
- `error`: one line saying why (`problem.message`) and the way to the setting to fix (`problem.fix`); Publish says Try again.

Publish asks nothing (publishing is reversible through Versions). Discard asks first in a confirm. Versions reads when its menu opens (`onVersions`); the live one is marked and can't be picked; picking another calls `onRestore`, which brings it back as the draft. Changes is a disclosure (`aria-expanded` on its button), the status is a polite live region and the refusal an alert.

## Differences from the artifact

Not in the artifact yet; it goes with the next `pnpm ui:artifact`.
