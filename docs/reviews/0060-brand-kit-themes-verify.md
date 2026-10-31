# /check verify 0060 brand kit and link page themes · FAIL

Branch `wip/visual-brand` at `21afc4609`, 31 Oct 2026. Run against the real app (api, worker and Vite dev on their own ports, a throwaway database `crm_vb`, one headless Chromium driven by scripts). Screenshots sit in the verifying session's scratchpad (`vb-verify/shots/`); the names below are those files.

**One criterion fails outright, one built surface is missing from this branch, and a few could not be run locally. Everything else passed with evidence.**

## What fails

- **AC-4, hosted forms wear no brand.** `/f/project-enquiry` drew the product blue Send button, no logo, and asked for no `brand.css`. The api answers `brand: { version, logo }` for the form, but both `brandHref()` in `apps/web/src/public/stylesheet.ts` and the routes in `apps/api/src/public/brand-css.ts` (plus `PUBLIC_KEY` in `packages/contracts/src/workspace-brand.ts`) only accept a 16 character key (`^[A-Za-z0-9_-]{16}$`). Form keys are slugs (`project-enquiry`, and the default `form-jz4v5t`), so every form is refused: `GET /api/public/forms/project-enquiry/brand.css?v=1cf7b2a7cc8a` answers 404, and the logo route too. Booking pages work because their keys are 16 characters. Shot: `70-form-light.png`. Run `/debug`.
- **Phone previews only paint the look behind the content.** In the Design panel, every look with its own ground (Paper, Bold, Ink, Dawn, Ocean, Mint, Studio, Editorial, Night, Peach, Graphite, a photo) fills the phone only as far as the last block, and the rest of the frame stays the app's surface. In dark mode the Brand screen's Form preview does the same (a white card, then dark below). The public pages fill the whole window correctly. Shots: `m-looks-preview-light.png`, `m-looks2-preview-light.png`, `96-kbd-customise-dark.png`, `15-brand-logo-dark.png`. This breaks AC-7's promise that the preview is exactly what visitors see, and AC-18's polish bar.

## Missing from this branch

- **AC-24, marketing.** No commit on this branch touches `apps/marketing`. The spec puts it in Lane 5, after lanes 1 to 4, so this may be expected; it still owes doing before the spec is done.

## Blocked locally (needs a production build, a Vercel preview, or a team)

- **AC-21 heading font preload and layout shift.** The handle shell (`handle-shell.ts`) only runs on Vercel, so the preload and a CLS trace need a preview deploy. The budgets are CI's (green).
- **AC-17 pixel identity of old looks.** Not diffed against main here; that is CI's screenshot job. The backfill itself was proven (below).
- **AC-4 and AC-14 team booking page.** This workspace has only a personal booking page, and team pages live in the Bookings area another session owns. Not exercised.
- **AC-20 inline styles.** The dev server injects its own `<style>` tags, so the "no inline style" check needs the built app (`build.test.ts` on CI). No style attribute from this spec was seen; the only ones are React Aria's hidden text and the calendar's `--slot-index`, both older.

## Per criterion

| AC | Verdict | Evidence |
|---|---|---|
| AC-1 | met | Owner edits; a member sees "Only owners and admins change the brand.", a locked hex and `canEdit:false`; previews update live (`10`, `11`, `93-member-brand.png`). |
| AC-2 | met | Logo upload 200 and drawn; SVG 400, PNG sent as JPEG 400, 5 MB 413 "smaller than 4 MB", foreign Origin 403; Remove asks in an alert dialog, then the logo route answers 404 (`15`, `99-remove-logo-modal-dark.png`). |
| AC-3 | met | Quick hue, hex field and native picker all set it; Timefix is the empty choice (`11`, `12`, `13`). |
| AC-4 | **fail** | Personal booking page: chosen day, Book and logo in the brand, `brand.css` 200 (`70-booking-personal-light.png`). Hosted form: no brand at all (above). Team page blocked. |
| AC-5 | met | axe colour contrast on the public page in light and dark for Dawn, Peach, Bold, Ink, Night, Graphite, Studio, Mint with a pure yellow accent: no violations. |
| AC-6 | met | `#ffff00` shows both swatches and "Adjusted so text stays readable."; the Dark colour row takes `#000080` and the guard moves it (`12`, `98-dark-colour-navy.png`). |
| AC-7 | partly | Same variables in preview and `look.css`; but the preview frame does not match the page (fail above). |
| AC-8 | met | 14 looks, each saves (`profile/saveTheme` 200) and the public page carries the same `data-page-*` set for every one; Gallery without a photo opens the photo row. |
| AC-9 | met | Customise rows are tile grids, keyboard reachable; the probe passes every row. There are eight rows (Corners and Face added), not six. |
| AC-10 | met | Grounds, eight gradients, four patterns and Photo all draw; photo ground served from our own route. |
| AC-11 | met | Photo ground: blocks on a solid card, contrast clean (`58-public-cover-display-light.png`). |
| AC-12 | met | Display pack: heading `Instrument Serif`, only Inter and InstrumentSerif files requested. |
| AC-13 | met | Cover band about 3:1 with the rounded avatar over its edge; left header on Editorial (`60-public-cover-light.png`). |
| AC-14 | met (team blocked) | Own accent Purple: the personal booking page switched to `#9a6af1` from first paint. |
| AC-15 | met | Follow visitor flips with the system setting; fixed Light stays light under a dark system (`m-mode.png`). |
| AC-16 | met | "How it looks" in Add item wears Night (`ink/dark/display`) (`97-draft-light.png`). |
| AC-17 | partly | Backfill run in a rolled back transaction on an old six key look: keeps its keys, gains the four defaults. Pixel diff is CI's. |
| AC-18 | partly | Probe passes every tile row and the remove dialog; keyboard pass clean with visible rings. Preview fill bug above; a 180 ms opacity rise still runs under reduced motion. |
| AC-19 | met | "Powered by Timefix" on every look of the link page and on the booking page. On the form it is the Timefix mark alone with no "Powered by" words (older form footer). |
| AC-20 | met (inline style blocked) | Every request on `/<handle>`, `/b/`, `/f/` went to `http://localhost:5290`; CSP files unchanged against the merge base. |
| AC-21 | partly | `look.css` 243 bytes, `public, max-age=3600, s-maxage=3600`; an old `?v=` answers 404 `no-store`. `brand.css` is cached 300 s, not 3600. Preload and CLS blocked. |
| AC-22 | met | `#12345g`, `red`, `#123456;}`, `#1234567` all `INPUT_INVALID`; direct database writes of a bad hex fail both checks; old image versions 404 `no-store`. |
| AC-23 | met | Member: `brand.save` 403 `FORBIDDEN`, logo upload 403. Another workspace's person: `NOT_FOUND`. `workspace_brands` has forced row level security and one policy. |
| AC-24 | missing | Not on this branch. |

## Short of world class (worth a pass, not blocking)

- Dawn's Tinted blocks are a muddy grey on the peach gradient; Graphite's thumbnail buttons nearly vanish.
- Font tiles all read "Aa" at a tiny size, so Modern, Mono, Grotesk and Friendly look the same; Soft and Round corner tiles look the same; Follow visitor's tile looks like Light.
- The upload hint says "image/png, image/jpeg, image/webp · up to 20 MB" (raw types, and 20 MB against a 4 MB rule, even if the browser shrinks the file).
- The Brand screen's booking preview is cut off at the times and never shows its footer; its logo sits far above the team avatar, which stays the product's light blue.
- The logo pops in after the booking page header has drawn, nudging the content down.
- "Any colour" opens the browser's own colour window, which covers the row's label.
- A member's swatches are announced as working radios though clicks do nothing; the logo row shows a disabled "Logo" bar instead of the logo.
- With Dark colour open, the "Adjusted" line for the dark accent sits under the light field, and the disclosure button is 6 px left of the field edge.
- The probe's spacing check flags the library's 1 px button and input padding on every screen (probe noise, worth an `allowSpacing` default).

Nothing was ticked in `verify.md` or the scope, since the verdict is FAIL. Next: `/debug` the form key pattern and the preview fill, then verify again on a preview deploy for the preload, CLS and inline style checks.
