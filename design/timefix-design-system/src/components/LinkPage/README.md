LinkPage is a person's public link page, Linktree simple: their face, name and bio, their social marks, their blocks in the order they set, and "Powered by Timefix".

**Use it for**: the public `/<handle>` page and the editor's phone preview (`isPreview`). `PageColumn` is the centred column every public page sits in (480 narrow, 640 wide). **Don't use it for** booking pages or forms; those are BookingFlow and the form page.

**The consumer provides**: `profile` (name, bio, photo), `socials`, `blocks` (link, header, booking, social, divider; a link draws as a button, a tile or the featured card with a picture), `look` (Calm, Bold, Soft, Night or Custom) with `accent` for Custom, and `booking` (the calendar functions BookingFlow needs). Nothing inside fetches.

**States**: four looks plus Custom, whose buttons take the brand colour with white or ink text by contrast. Hidden blocks never draw. With no social block the marks sit under the bio. A booking block without `booking` keeps Book disabled. A sign-up block says what signing up means under its field ("You'll get emails from Priya Raman. Unsubscribe any time.").

**Interaction**: buttons lift 2px on hover and ease to 0.97 when pressed. Switching looks eases every colour over 250ms. Book opens the booking card in place under its block (accordion, 0fr to 1fr and its label swaps to Close. Tab walks the marks, then every block in order.

**Replaces**: LinkPage, PageColumn, LinkPageTile and the public link page parts.


**Wave D1**: blocks carry `showFrom`/`showUntil` (`isShown(block, now)` decides), `size` (`small` sits two to a row, `large` makes a link a card), `gate` (a link asks first in a Dialog: sensitive, 18+ or 21+) and `archived`. New kinds: `next` (the soonest three open times from `booking`, any of them opens the booking card), `media` (`mediaKind(url)` names YouTube, Vimeo, Spotify, SoundCloud, Apple Music), `picture`, `gallery`, `banner`; a `header` with `folds` gathers the blocks under it into a section that opens and closes. The profile takes `title`, `shape` (`circle` or `rounded`), `cover` (a photo instead of the rings) and `ground` (a photo behind the page); `closing` is one line over the foot.

`profile.groundColour` paints the page's ground (a dark colour turns the page dark); `members` lists a team's or company's people under the name.
