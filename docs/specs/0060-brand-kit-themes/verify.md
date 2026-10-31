# 0060 verify: Brand kit and link page themes

How `/check verify` proves each criterion on the real app. Screenshots are taken in light, dark and follow visitor, inside the real layout, with a popover open where one exists. The agent that verifies looks at every screenshot itself before a lane lands. Heavy suites run on CI.

## Contrast (AC-5, AC-6, AC-7, AC-11)

- A property test over at least 5,000 random hexes, plus the nine library hues, pure black, pure white and pure yellow: every pair `brandVariables()` returns meets 4.5:1 for text and 3:1 for control edges and focus, in light and dark.
- A unit test that the adjusted flag and the colour difference are set when, and only when, the guard moved the colour by more than 10.
- A browser test that the editor preview and the live page compute the same variables for the same hex (read from computed style).
- With a photo ground in both modes, axe finds no contrast failure on the hero, the blocks or the foot.

## Old pages unchanged (AC-17)

- Screenshot diff of every existing preset and of ten stored themes sampled from a seeded database, before and after the migration: no pixel change.
- A migration test: every row has all ten keys after the backfill, and the new check accepts every row.

## Safety (AC-20, AC-22, AC-23)

- The CSP test (`csp.test.ts`, `style-csp.test.ts`) passes unchanged, and a new test proves no public page HTML carries a `style` attribute.
- Network log on `/<handle>`, `/b/:key` and `/f/:key`: every request goes to our own origin.
- Refusals: `brand.save` with `#12345g`, `red`, `#123456;}` and a 7 digit hex answers `INPUT_INVALID`. A direct insert of a bad hex fails the database check. An image route with an old `?v=` answers 404 `no-store`.
- Access: a member without admin power gets `FORBIDDEN` on `brand.save` and 403 on the logo upload. Another member cannot save someone else's look or accent. A cross workspace read of the brand returns nothing (the guard test pattern).
- Uploads: an SVG, a file over 4 MB, a PNG named `.jpg` with JPEG first bytes mismatched, and an eleventh upload in an hour are each refused with the documented code.

## Speed (AC-21)

- `pnpm size` budgets pass on CI with at most 1 kB added to each public page's JavaScript and at most 4 kB to the shared CSS.
- The look stylesheet answers under 1 kB, with `public, max-age=3600, s-maxage=3600`.
- A Lighthouse or Playwright trace on a page with the Display pack: layout shift under 0.05, heading font requested by preload.

## Per criterion

| AC | How it is checked |
|---|---|
| AC-1 | Browser test: an admin sees Settings › Brand and edits it, a member sees it read only, the previews update live. |
| AC-2 | Upload tests above, plus removing the logo opens a Modal and the logo route answers 404 after. |
| AC-3 | Browser test: hex field, swatch picker and the nine quick hues all set the accent, clearing it returns the product accent. |
| AC-4 | Browser tests on a team booking page, a personal one and a form: accent on buttons, chosen day, links and focus, logo in the header. Existing booking and form flows pass on CI unchanged. |
| AC-8 | Browser test: the gallery shows 14 thumbnails, picking one updates the preview and saves. |
| AC-9 | Browser test and screenshot: six Customise rows, each a visual tile row, keyboard reachable. |
| AC-10 | Screenshot set of every ground, gradient and pattern in light and dark. |
| AC-12 | Each pack renders its heading and body font (computed `font-family` and the font file requested), and only that pack's files load. |
| AC-13 | Screenshots of the three headers and three avatar shapes, and a cover upload cropped to 3:1. |
| AC-14 | Browser test: with no own accent the link page follows the workspace, with one set the link page and its personal booking page both use it, a team page keeps the workspace accent. |
| AC-15 | Emulated light and dark system settings flip a follow visitor page and leave a fixed mode page alone. |
| AC-16 | Browser test: the block draft preview and phone preview carry the look's data attributes and variables. |
| AC-18 | The 0058 alignment probe and motion checks on the Design panel and Settings › Brand. Reviewer pass for less text and delight. |
| AC-19 | Every public page shows "Powered by Timefix" in every look, aligned at the foot (alignment probe). |
| AC-24 | Marketing build passes, new shots exist in light and dark, every claim checked against shipped code. |

## Before landing a lane

1. Lane skill pass: `crm-design-system`, `interaction-design`, `emil-design-eng`, `interface-affordances`, `subtractive-design`, plus `crm-data-model-access` and `crm-api-backend` for Lane 1.
2. Reviewers: `security-access-reviewer` and `state-performance-reviewer` for Lanes 1, 3 and 4; `design-system-guardian` then `ux-interaction-reviewer` for Lanes 2 and 3.
3. Screenshots in light, dark and follow visitor, viewed before landing.
4. Heavy suites on CI via the lane push script, nothing heavy locally.
