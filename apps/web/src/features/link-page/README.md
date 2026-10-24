# The link page editor (spec 0051, built as blocks)

## Settings › Account › Profile › Link page (`/w/$slug/settings/account/profile?view=link-page`, LinkPageLoader, LinkPageScreen)

- **Purpose**: what the person's page at `/<handle>` holds, in order, beside a phone that shows it as a visitor will.
- **Main task**: add a booking page, a link or a heading, edit it, move it, archive or delete it; every change shows at once, on the list and in the phone, and is saved as it is made.
- **Leaves out**: the contact card, the QR and the socials row (later phases), themes and appearance, and the handle (Settings › Profile).

A view of Profile's (its trail reads Settings › Account › Profile › Link page; Profile stays the current place in the settings sidebar), opened from Profile's Your link page row and the booking editor's Link page card. Why a view and not a route of its own: a route's loader and chunk list sit in the app's first load, which had 300 B less room than a route needs (250 kB budget); the view's store, screen and copy all load with Profile's own chunk and `data.linkPage.load()`. It is a settings page that fills the view (`fillsView`) with PreviewLayout under its bar: the blocks in a Card beside the phone, whose page is the library's LinkPage drawn from the editor's own list (`isPreview`: never a frame, never the public origin); under the layout's width, Preview opens it in a sheet. The bar holds View page (the public page in a new tab).

- **Blocks**: a LinkList with `leadingLoading` (each row's tile is the page's own, `LinkPageTile`), grips (drag, and the keyboard on the grip: Enter, the arrows, Enter), and a menu per row: Edit (links and headings), Copy link (a link's address, a booking page's `/<handle>/<slug>`), Move up and Move down (only the moves there is room for, announced in a status region), Archive (one press: it can be restored), and Delete, which asks first (`tone="danger"`, "Delete block") and waits there for the server. Pressing a row opens its editor. A paused page shows Paused; a page made Link only, deleted, or in a workspace the person left shows Unavailable, kept until they delete it.
- **Add**: a Menu of the registry's kinds (`registry.tsx`): Booking page, Link, Heading, each with its line, and a full kind disabled with the limit's sentence (60 blocks, 40 links, 12 headings).
- **Editors** (`editors.tsx`): one Modal per kind, its form checked by `data.linkPage.check` (the server's rules, before anything is sent: a title, the address rule, a note's length, a heading's text once), with "How it looks" under the fields: the one block drawn as typed by LinkPage's `layout="blocks"` (the unsaved draft, AC-5119), the network's mark included (`data.linkPage.markOf`). A link's address is kept as typed (https added to a bare one): never wrapped. Booking page lists the person's Public pages from every workspace not on the page yet, the workspace named when there are several, read fresh each time it opens; with none left it says so and offers Make a booking page.
- **Archived**: a Card under the blocks while there are any, each with Restore (back to the end) and Delete.
- **Saving**: through `data.linkPage` only (optimistic, in order, put back with a toast and Try again on a refusal).

States: no handle (claim one first, Go to Profile), loading (the route's pending page: the Card's tiled skeleton rows and the phone's page skeleton), failed (one row with Try again), empty (a quiet row, and the phone's empty page), and the limits.

## The registry (`registry.tsx`)

The one place a kind of block plugs into the editor: its Add entry (label, line, icon), its editor Modal, how its row reads, what Copy link copies, and how it draws in the phone. A later kind is one entry here, a schema in `@crm/contracts` (`ProfileBlock`), a renderer in the library's LinkPage, and a line in the public page's `blocksOf`. Planned, not built: text, photo and video, video and music embeds (the visitor picks their service), FAQ, testimonials, folders and tabs, a Timefix form, an email capture, the contact card (phase 2).
