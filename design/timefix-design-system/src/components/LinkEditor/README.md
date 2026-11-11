LinkEditor is where a person builds their link page: blocks on the left, a live phone preview on the right, and Publish once the draft differs from the live page.

**Use it for**: the link page editor. **Don't use it for** settings that take effect at once; this page drafts and publishes.

**The consumer provides**: `live` (the page guests see: profile, socials, blocks, look, accent, and `details`: site title, closing line, share image, search indexing), `onPublish(draft)`, a promise, and `booking` for the preview's booking block. The editor keeps the draft itself.

**States**: the profile row (photo with crop, name, title, bio, photo shape), Design (template, own colour, cover and background photos, each cropped) and Details beside each other, Import (paste links or a page's text; review the links found; it never fetches another site), blocks with a grip, a tile, title and address, click counts and a show switch (hidden blocks dim). A deleted block leaves "Deleted · Undo". Every block but dividers and social icons has More options: show from and until (a row says "Not showing today" outside them), size (small sits two to a row), and for links and media Ask first (sensitive, 18+, 21+). Archive takes a block off the page and keeps it in Archived, where Restore brings it back and Delete asks first. New kinds: Next times, Video or music, Picture, Gallery, Banner, and a Header that folds shut. PublishBar counts unpublished changes, then publishes and says so.

**Interaction**: drag a grip, or focus it and press Space, arrows and Space (Esc puts it back), to reorder (lib/drag.ts, one feel with the board): the copy lifts under the pointer, a dashed gap opens where it will land and the other blocks slide aside. A click on a row (or Tab to it and Enter) opens it in the side panel; the list and panel slide side by side (8px. Typing updates the preview at once. New blocks drop in at the top and open for editing; an edited row gets a brief accent wash. Pasting a social link swaps in the network's mark.

**Replaces**: the link page editor pieces: block rows, LinkListRowOrder, the phone preview and their dialogs.
