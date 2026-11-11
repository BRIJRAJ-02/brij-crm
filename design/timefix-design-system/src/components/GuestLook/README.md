GuestLook is where an owner picks what their guest pages wear: one of four looks or Custom, then the accent, the face and light or dark, beside a live preview of the page.

**Use it for**: the Design settings of booking pages, forms, menus and business pages, so they all read as one product. **Don't use it for** the app's own theme (that is the user's appearance setting) or for a single page's colour field alone (use AccentPicker).

**The consumer provides**: `value` (`look`, `accent` as "#RRGGBB", `font` of sans (Geist) or mono (Geist Mono), `scheme`) and `onChange`; optional `host` and `title` for the preview. `GUEST_LOOKS` lists the four looks; `GuestLookPreview` draws the preview alone. `isPreviewHidden` draws only the controls when the page has its own live preview (a form's Look popover). `guestLookProps(value)` gives a page's root its theme and the accent as primary, accent and face, so everything inside follows through the tokens.

**States**: Calm, Ink, Warm and Night pick a whole look; changing the accent, face or appearance by hand makes it Custom, and Custom remembers the last look made by hand. Each tile carries a swatch drawn in its own look. The preview's Book button and picked day use the accent with white or ink text, whichever reads.

**Interaction**: the looks are a radio group (arrows move, the chosen tile shows its check badge). Font and Appearance are segmented controls whose pill slides (tabs sliding). The preview's colours ease over 250ms and its caption's words cross-blur in place while their width eases (transitions.dev text swap soft).

**Replaces**: GuestLook, MenuLookThumbnail and the look presets on the Design page.
