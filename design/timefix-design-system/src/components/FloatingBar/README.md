A floating bar is a pill at the bottom of a region that holds the actions for what the user has just done: selected rows, unsaved changes, an unpublished draft.

**Use it for**: `BulkActionBar` (ink) when rows are selected: "3 selected", up to three actions, ×. `SaveBar` (ink) on settings pages and editors with unsaved changes: Discard and Save. `PublishBar` (white) when a public page has a draft guests have not seen. `FloatingBar` itself for other bars (the visitor bar on a public page), with `BarButton` for actions on ink. **Don't** show two bars in one region, or use a bar for a message with no action (use a toast).

**The consumer provides**: a region with `position: relative`; BulkActionBar takes `count`, the actions and `onClear`; SaveBar takes `status` (`hidden`, `unsaved`, `saving`, `saved`), `onSave`, `onDiscard`, an optional `note`; PublishBar takes `status`, `changes`, `onPublish`, optional `onPreview`, `onDiscard`, `message` ("Not published yet") and `isPublishDisabled` (a taken link, no name). Every editor with a public page uses it (booking pages, forms, the link page): one header row above, this bar at the foot.

**Toasts**: while a bar is up, toasts rise above it (the bar sets `--tf-toast-lift` on the page), so a toast never covers its actions.

**States**: hidden, shown, busy (spinner in the main action), done (drawn tick and "Saved" / "Published", then the bar drops away).

**Interaction**: the bar is a toolbar, so Tab enters it once and arrows move between buttons; Esc clears a selection; ⌘S saves. It rises with transitions.dev toast motion (16px, 0.97, 350ms) and leaves in 250ms; labels crossfade so the pill never jumps; the count rolls.

**Replaces**: FloatingBar, BulkActionBar, SaveBar, PublishBar, VisitorBar.


**One publish system**: every editor that drafts (forms, booking pages, the link page and team pages, menus, the business page) uses PublishBar with the same words: never published "Not published yet · Publish" (`message`), changes "N unpublished changes · Discard · Publish", then the spinner and "Guests see the new page". No editor keeps its own Publish button beside it. A first publish opens ShareSheet.
