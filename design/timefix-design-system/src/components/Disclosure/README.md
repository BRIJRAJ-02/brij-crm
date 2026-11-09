Disclosure rows fold content away under a 44px head that opens a panel below it, one at a time or several at once, plus a quiet "Show advanced settings" link for settings forms.

**Use it for**: grouped settings on a booking page or form (Availability, Booking questions, Notifications), FAQs on public pages, filter sections, and the advanced options of a settings section. **Don't use it for**: switching between peer sections (use `Tabs`) or hiding the only thing on a page.

**The consumer provides**: `DisclosureGroup` (`allowsMultipleExpanded`, `defaultExpandedKeys` or controlled `expandedKeys`, `variant` `card` or `plain`) holding `DisclosureItem`s (`id`, `title`, optional grey `description`, 16px `icon`, an `end` slot for a Count or Tag, `isDisabled`). `ShowMore` takes the advanced fields as children and optional show and hide labels.

**States**: closed, hover (row washes), open (chevron points up), focus-visible (ring inside the row), disabled.

**Interaction**: the head is a button inside a heading; Enter or Space toggles it. The panel's height tweens over 250ms on the smooth-out curve while its content fades in and unblurs from 2px, and the chevron flips vertically through a flat line (transitions.dev 21, accordion). `ShowMore` crossfades its label (Show ↔ Hide). Collapsed content stays findable with the browser's find in page.

**Replaces**: Disclosure.
