EmbedPreview is the Share tab's embed choice: how a booking page sits on someone's site, shown live on a made-up site, with the code to paste.

**Use it for**: embedding booking pages and forms on an outside site. **Don't use it for** sharing a plain link (that is Copy link on the page's card) or for previewing the real page (that is the page itself).

**The consumer provides**: `page` (the BookingPagePicture props: host, title, duration, open days, hue), `url`, `words` for the popup and floating buttons, `accent` ("#RRGGBB") for the floating button, `site` for the frame's address, and `mode` with `onModeChange` (or `defaultMode`). `embedSnippet(mode, url, words, accent)` builds the same code for anywhere else that needs it.

**States**: In the page draws the page's picture among the site's lines; Popup button draws the site's own plain button and the page over a scrim; Floating button draws our button in the corner in the accent, with white or ink words, whichever reads. Copy code turns to Copied for 1.6 seconds.

**Interaction**: the three ways are a segmented control (arrows move, the pill slides). A new way slides the site in 8px through a 3px blur (transitions.dev page side-by-side); the popup scales in from 0.96 and the floating button rises after it. The snippet cross-blurs to its new text (text swap soft) and is focusable for scrolling. Copy code morphs to Copied (text morph) while its icon swaps to a check (icon swap); a polite status says "Code copied". The preview is one image to screen readers, named by its caption.

**Replaces**: EmbedPreview, the embed tiles and the snippet block on the Share tab.
