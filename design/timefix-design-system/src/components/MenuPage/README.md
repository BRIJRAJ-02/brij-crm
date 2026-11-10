MenuPage is a restaurant's public menu at `timefix.com/<handle>/menu`, the page a table's QR code opens: one column a phone holds, a menu switcher (Lunch, Dinner, Drinks), search and dietary filters, sections as sticky pills, dishes as rows (or a photo grid) with price, marks and a photo, a sheet for each dish, and a selection to show the server.

**Use it for**: the guest menu, the menu editor's preview (`isPreview`), and any later module that lists things to read and pick without paying online. **Don't use it for** booking (VenuePage and BookingFlow) or a person's links (LinkPage).

**The consumer provides**: `venue`, a `line` under the menu name, an optional `cover`, `menus` (sections of dish ids, serving times, tax and service in percent, a foot note, `isLive`), `dishes` (one price, sizes, or a price note; dietary marks from `DIETS`; allergens from `ALLERGENS` as contains or may contain; add-on ids; calories; popular; sold out), `addOns` (min and max: max 1 is choose one, min 1 is required), `table` from the QR, `now` in minutes for "Served from", `money` to format prices, `onBookTable`, and `foot`. Nothing inside fetches or sends.

**States**: a menu not served yet says when it is; sold out dishes stay in place, dimmed, and their sheet can't add; nothing matching a search or filter offers Show everything; no live menu shows "The menu isn't up right now" with Book a table. The selection bar appears with the first pick; Clear all has Undo.

**Interaction**: tap a dish to open it; a required add-on keeps Add disabled and says what to choose; the stepper runs 1 to 99. The selection says "Nothing is sent from this page": there is no ordering or paying, as on main.

**Accessibility**: dishes are buttons named with their price and sold out state; pills and filters are buttons (`aria-pressed` on filters); sizes and choose-one add-ons are radio groups, the rest checkboxes; quantity changes are announced.
