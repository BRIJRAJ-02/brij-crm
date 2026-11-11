LinkEditor is where a person builds their link page: blocks on the left, a live phone preview on the right, and Publish once the draft differs from the live page.

**Use it for**: the link page editor. **Don't use it for** settings that take effect at once; this page drafts and publishes.

**The consumer provides**: `live` (the page guests see: profile, socials, blocks, look, accent), `onPublish(draft)`, a promise, and `booking` for the preview's booking block. The editor keeps the draft itself.

**States**: the look picker (Calm, Bold, Soft, Night, Custom, which opens the colour picker), the profile row, blocks with a grip, a tile, title and address, click counts and a show switch (hidden blocks dim). A deleted block leaves "Deleted · Undo". PublishBar counts unpublished changes, then publishes and says so.

**Interaction**: drag a grip, or focus it and press Enter, arrows and Enter, to reorder; the row lifts, its source fades and the drop slot opens dashed. Enter or a click on a row opens it in the side panel; the list and panel slide side by side (8px. Typing updates the preview at once. New blocks drop in at the top and open for editing; an edited row gets a brief accent wash. Pasting a social link swaps in the network's mark.

**Replaces**: the link page editor pieces: block rows, LinkListRowOrder, the phone preview and their dialogs.
