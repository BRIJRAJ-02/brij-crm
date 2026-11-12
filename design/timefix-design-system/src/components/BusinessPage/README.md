BusinessPage is a venue's public page, after Fresha's: cover, name, rating, address and whether it is open, then the service menu (or a party size for a restaurant), a person to see, and the booking card.

**Use it for**: salons, clinics and restaurants at their public handle. `ServiceMenu` and `PartyBand` are exported on their own for the editor's preview and the reservation page. **Don't use it for** a person's link page (LinkPage) or a single booking page (BookingFlow alone).

**The consumer provides**: `business` (name, kind, rating, reviews, address, phone, optional cover, `opensAt`, `closesAt` and `now` as minutes in the place's clock), `mode` (`services` or `table`), `categories` of services (name, minutes, price as written, optional description), `staff`, `partyMax` (8), `tableMinutes`, and `booking`, BookingFlow's calendar, times and `onBook`.

**States**: open now or closed with the next opening; no cover (the header leads); services with or without staff; party sizes 1 to 7 and 8+, where 8+ opens a line to call and turns Find a table off.

**Interaction**: the category tabs stick under the top and follow the scroll; pressing one scrolls to its section (smoothly, or at once under reduced motion). Book moves to the person step, then the booking card, sliding side by side 8px through while the box eases to the new height (transitions.dev page side-by-side, card resize); Back returns and focus follows each step. The header's lines reveal 40ms apart; the party note opens in flow (accordion). "Powered by Timefix" stays at the foot.

**Replaces**: BusinessPage and its gallery, menu, hours, location and reserve parts, MenuList (as ServiceMenu) and PartyBand.
