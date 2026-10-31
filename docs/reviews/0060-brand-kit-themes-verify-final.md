# /check verify 0060 brand kit and link page themes, final · one must fix

Branch `wip/visual-brand` at `943b0d527` (CI green, run 41168126800), 31 Oct 2026. Run against the real app: api, worker and Vite dev on their own ports (3380, 3381, 5380), a fresh database `crm_vkfin` (migrated, then dropped), and one headless Chromium driven by scripts. Shots are in the verifying session's scratchpad, `vkfin/shots/`. Every shot named below was looked at.

**All nine fixes from the first review hold, with evidence. One must fix is left in the real layout: at 390 px the link page editor's header runs off the screen, so Done and Share sit past the right edge.** It comes from the 0058 header (Live, address, Share, Done) that this branch carries, not from 0060's own code, but the Design panel lives on that screen, so it blocks landing this branch as it is.

## Must fix

- **The link page editor scrolls sideways at 390 px.** On `/w/<ws>/link-page?edit=true` the document is 515 px wide in a 390 px window. Share sits at 362 to 436 and Done at 444 to 515, so on a phone, Done is off screen until you scroll the page sideways. Shot: `d-gallery-dawn-390-light.png` (the header is cut at the right edge). The fix belongs in the header: drop the address chip, or fold Share into it, below a phone width. Run `/debug`.

## The nine fixes, rechecked

| # | Fix | Verdict | Evidence |
|---|---|---|---|
| 1 | A form wears the brand by its slug | met | `/f/project-enquiry`: `brand.css?v=…` 200 `text/css`, `logo?v=…` 200 `image/png`, `--brand-accent: #d9468f`, Send is `rgb(217, 70, 143)` (`p-form-1440-light.png`, `p-form-390-light.png`). |
| 2 | Previews fill their frames | met | Dawn's page ground runs 105 to 917 px, the same as its frame, gradient to the foot (`d-dawn-phone-1440.png`). The dark Brand screen's form preview is one light card to the frame's foot (`b-brand-form-1440-dark.png`, `b-brand-preview-form-390-dark.png`). |
| 3 | brand.css and the logo are cached under `brand:<workspace>` and purged on a save | met, with one gap | Headers seen: both answer `public, max-age=3600, s-maxage=3600`. An old `?v=` answers 404 `no-store`. The tag is set through Vercel's `addCacheTag()`, not as a response header, and the local server's edge cache does nothing, so the tag can't be seen locally. It is covered by `apps/api/src/brand.test.ts` ("keeps brand.css and the logo an hour under the workspace's tag, and a save purges it"), green on CI: a kit save, a logo upload and a logo removal each purge `brand:<id>`. **Should fix:** that test doesn't check the purge on an own accent save (`profile.saveAccent`), which the commit says purges too. |
| 4 | Reduced motion: the link page runs no animation | met | `/kira-fin` with motion on runs `ws-link-page-rise 180`; with reduced motion it doesn't. (The loading skeleton's text line still pulses under reduced motion, see below.) |
| 5 | Logo and header in the same frame | met | Every frame of each page's load is sampled. The booking page has its logo drawn in 160 of 160 frames and the form in 174 of 174, and the `h1` never moves (one top position each). |
| 6 | Upload hint | met | "PNG, JPG or WebP · up to 4 MB" (`b-brand-booking-1440-light.png`). |
| 7 | A member sees the colour as text beside one swatch | met | One swatch and `#d9468f` as a paragraph, no radios. The note reads "Only owners and admins change the brand." `brand.save` answers 403 `FORBIDDEN` (`m-member-brand-1440-light.png`). |
| 8 | Customise tiles | met | Each font tile's sample is drawn in its own face: Inter, JetBrains Mono, Host Grotesk, Fraunces, Newsreader, Bricolage Grotesque, Outfit and Instrument Serif. Corners show one button each. Follow visitor is split light and dark on a diagonal (`d-customise-font-1440-light.png`, `d-customise-mode-1440-dark.png`, `d-customise-font-390-dark.png`). |
| 9 | Dawn rows are white pills | met | Rows are `rgb(254, 255, 255)` with a 9999 px radius (`d-dawn-phone-1440.png`, `p-link-1440-light.png`). |

## Quick pass over the 24 criteria

Covered here: the Brand screen (light, dark, 1440 and 390, the preview popup at 390, the Any colour picker and the remove logo dialog open), the Design panel (light, dark, 1440 and 390), and the three public pages with the brand applied (light, dark, 1440 and 390). The alignment probe and axe ran on each of them.

| AC | Verdict | Evidence |
|---|---|---|
| AC-1 | met | Owner edits, member read only, previews update (`b-brand-*`, `m-member-brand-*`). |
| AC-2 | met | Upload 200 and drawn. SVG 400, PNG sent as JPEG 400, 5 MB 413, foreign Origin 403. Remove asks first (`b-brand-remove-modal-1440-*`); the probe passes the dialog. |
| AC-3 | met | Hex field, quick hues and the native picker (`b-brand-anycolour-1440-light.png`). |
| AC-4 | met (team page not run) | Personal booking page: chosen day, Book and logo in the brand. The form too (above). This workspace has no team page. |
| AC-5 | met | axe is clean on all three public pages in light and dark. |
| AC-6 | met in the first review | Not changed since. |
| AC-7 | met | Previews now match the page (fix 2). |
| AC-8 | met | 14 looks in the gallery. Picking one saves and redraws the preview. |
| AC-9 | met | Customise has nine rows, all tile grids (Corners and Face added beyond the spec's six). The probe passes each row on its own. Run over the whole screen, the probe compares 32 px swatches with 120 px tiles across rows; that is probe noise. |
| AC-10, 11, 12, 13 | met | Font packs above. Grounds, photo, cover and header as in the first review, with no change since. |
| AC-14 | met in the first review | Not run again. |
| AC-15 | met | The page set to Follow visitor draws dark for a dark visitor (`p-link-390-dark.png`) and light for a light one (`p-link-390-light.png`). |
| AC-16 | met in the first review | Not run again. |
| AC-17 | CI | The pixel diff is CI's screenshot job (green). |
| AC-18 | met | Probe and axe are clean on the new screens. Reduced motion drops the rise, and colour fades of 120 ms remain. |
| AC-19 | met, one should fix | "Powered by" and the Timefix mark are on the link page and the booking page in every width and mode. The hosted form shows the Timefix mark alone (alt "Made with Timefix"), with no "Powered by" words. That form footer came with the forms work, not 0060. |
| AC-20 | met (inline styles: CI) | Every request on the three pages went to `http://localhost:5380`. |
| AC-21 | met (preload and layout shift need a preview) | `look.css` and `brand.css` both answer `public, max-age=3600, s-maxage=3600`. |
| AC-22 | met | `#12345g`, `red`, `#123456;}` and `#1234567` all answer 400 `INPUT_INVALID`. An old version answers 404 `no-store`, and a bad form key 404. |
| AC-23 | met | A member's `brand.save` answers 403 `FORBIDDEN`. |
| AC-24 | missing | Marketing is Lane 5, not on this branch. |

## Should fix (not blocking)

- The hosted form says "Made with Timefix" (mark only) where the booking and link pages say "Powered by Timefix" (AC-19's words). Worth matching the other two.
- The own accent purge isn't asserted in `brand.test.ts` (fix 3 above).
- Skeleton's text lines (`data-shape='text'`, the `::before` bar) still pulse under reduced motion. The library's reduce rule covers `.root` but not that pseudo element. Seen on the link page while it loads.
- On the public link page, "Share this page" is a full width bar with only an icon, which reads as an empty row (`p-link-1440-light.png`). It is older than 0060.
- Brand screen at 390 px: the last swatch (the chosen custom colour) wraps alone onto a second line (`b-brand-booking-390-dark.png`).
- Still open from the first review: the booking preview is cut off at "Tomorrow". A member's logo row shows a disabled "Logo" bar, not the logo. "Any colour" opens the browser's picker over the row's label. The share picture hint still says "image/png, image/jpeg · up to 500 kB".
- In Customise, the row captions (Font, Buttons, Corners and the rest) sit closer to the row above than to their own tiles, so they read as small and loose.

Nothing was ticked in `verify.md` or the scope, since one must fix is open. Next: `/debug` the editor header at 390 px, then land.
