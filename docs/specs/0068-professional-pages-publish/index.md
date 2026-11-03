# 0068. Professional pages: four templates, and Publish for every public page

**Date**: 2026-11-04
**Status**: Proposed

**Numbering**: AC-6801 to AC-6899. Changes spec 0060 (page themes) and the save model of specs 0051/0056 (link pages) and 0021/0062 (booking pages). Every page type of specs 0065 and 0066 is born under this spec. It also holds the phase plan for 0062 to 0068 (below).

## Summary

The owner (4 Nov 2026): everything public must look professional; customisation on link pages should be four basic yet interactive professional templates; and every change to booking pages and link pages must wait for Publish, as forms already do. So the fourteen theme presets and their mix and match controls give way to four templates that each look finished with any accent and logo, used by every public page (link pages, booking pages, forms, business pages, menus, events). And editing a page changes a draft; guests keep seeing the published version until you press Publish.

## Requirements

*Templates*
- **AC-6801**: Four templates, each a complete, tested look:
  - **Classic**: white or near black (follows the visitor's light or dark), a clean grotesk, centred identity, full width rows with a soft lift on hover. For consultants, sales, agencies.
  - **Studio**: warm off white, an editorial serif for headings, a cover photo header, image led cards with rounded corners, pill chips. For salons, cafés, restaurants (SN's look, 0065 H5's Warm).
  - **Night**: deep dark ground, the accent as a glow on focus and hover, bold large type. For bars, gyms, creators, events.
  - **Split**: on wide screens a sticky identity panel on the left (logo, name, open now, Book) and the content on the right; one column on phones. For clinics, studios, practices (after Fresha's venue page).
- **AC-6802**: What the owner customises, and only this: template, accent (brand kit), logo, cover photo (Studio, Split; optional elsewhere), and avatar shape (circle or rounded). Fonts, grounds, gradients, patterns, row shapes and fills are fixed per template. Every template passes WCAG AA with any accent: the accent is adjusted for contrast where it carries text (the 0060 rule).
- **AC-6803**: Interactive by default, in every template, from the shared motion parts: a once only staggered entrance (off under reduced motion), springy press states, a hover lift on rows and cards, photos fading in from a blurred placeholder, sticky section tabs that follow the scroll, and smooth crossfades between steps. No motion longer than the motion tokens allow.
- **AC-6806**: The motion comes from transitions.dev (owner, 4 Nov 2026; its licence allows use in our product, not resale as a motion kit), installed as the `transitions-dev` skill, built once as shared `@crm/ui` motion parts and tuned with `transitions-polish` against our motion tokens. Mapping:
  - steps of a booking, form or reservation flow: page side by side; height changes: card resize
  - prices, totals, "42 going", counters: number pop in; dashboard numbers: spinning counter; analytics rings: donut chart
  - Publish → Published, Book → Booked: text states swap; icon changes: icon swap
  - booking confirmed, registration done: success check
  - section tabs and template picker: tabs sliding; menus: menu dropdown; dialogs: modal; item sheet and side panels: panel reveal; FAQ and About: accordion
  - refused field: error state shake; clearing search: input clear dissolve; loading: skeleton reveal (never a flash); entrance of a page: texts reveal (once)
  - event guests: avatar group hover; toasts and undo: toast and banner stacking; checkboxes, consent ticks and switches: checkbox check and toggle; add menus: plus menu morph; tooltips: tooltip
  - not used on public pages: card tilt, matrix loader, thinking and streaming text (not professional for these pages).
  Every part honours reduced motion and has a story.
- **AC-6807**: Each key interaction is first made as a stageshow demo (the `stageshow` skill, installed): one interaction, one surface, one size (for example "a guest picks Any professional, a time, and sees the booking confirmed"; "an item sheet opens, a size is picked, the price pops"; "Publish turns into Published and the guest view updates"). The demo is filmed and fixed until it reads right, reviewed against the owner's references, and then its timing and details are carried into the library parts above. Demos stay as stories, and the best become loops for the marketing homepage.
- **AC-6804**: One look per workspace: the template lives in the brand kit and every public page uses it. A link page may pick another of the four for that person's page. The editor shows the four as large live previews of the real page (not thumbnails), switching with a crossfade.
- **AC-6805**: Existing pages move to the nearest template once, at migration: plain, paper, quiet, ocean, mint → Classic; editorial, dawn, gallery → Studio; ink, bold → Night; studio and any remaining → Split if they have a cover photo, else Classic. Old theme fields stay stored but unused; the editor shows a one time note "Your page now uses Classic" with a link to choose another.

*Publish for every public page*
- **AC-6810**: Link pages, booking pages, business pages (0066 B4), event pages (0066 B8) and menus (0065 H1, already) save edits into a draft. Guests see only the published version. Forms keep their existing publish model; the others follow it.
- **AC-6811**: The editor shows "3 changes not published" with Publish and Discard, a Preview that opens the draft as a guest would see it (private, signed in only), and a Changes list naming what differs ("Length 30 → 45 min", "Template Classic → Studio"). Publish asks nothing (it is reversible); Discard asks first.
- **AC-6812**: Each Publish keeps a version (who, when); the last 20 versions per page can be viewed and restored as a new draft.
- **AC-6813**: What stays instant (not drafted), because it is operational or shared: pausing and resuming a page; a member's availability schedules, time off and calendar connections (shared by many pages); one time links; requests, bookings and visits themselves; Sold out on menu items (0065 AC-6526); staff shifts and time off (0066); handles (reserved at once, live on publish).
- **AC-6814**: The slot engine and every public read use the published version: `loadPage` reads the published snapshot of a booking page; a page never published is not live. Booking pages that exist when this lands are published as they are (version 1), so nothing changes for guests.
- **AC-6815**: Managed pages (0021 templates): publishing the template publishes its locked parts to every member's page at once; a member's own unlocked edits stay in their draft until they publish.
- **AC-6816**: Publish purges the page's edge cache tags; the published snapshot is what the cache stores.

## Two rules across every phase (owner, 4 Nov 2026)

- **The dashboard stays as it is.** Templates, new looks and new motion are for public pages. Every app screen (settings, editors, calendar, service, menus, imports) uses the current design system exactly as the rest of the app does today: tokens, library components, the same layouts, density and copy style. A lane that needs something new adds a variant to the library, reviewed by the design system guardian; nothing app only.
- **Foolproof from the first click.** Every app starts with a setup checklist (the `SetupChecklist` module) that walks one step at a time (business, place and hours, then the app's own first thing, then Publish, then share); every empty state has exactly one next action; sensible defaults are filled so a first try works without reading anything; Publish refuses a page that would be broken (no price, no hours, no services) and says what to fix in one line with a link to it; destructive steps ask first and undo where they can; no screen is a dead end. Each phase's verify includes a first run walk by someone who has never seen the app.
- **Skills at every level.** Every lane loads the house skills for its area, the design skills pass for any UI (impeccable, interaction-design, emil-design-eng, ux-heuristics, interface-affordances), `transitions-dev` and `transitions-polish` for motion, `stageshow` for key interactions, `security-and-hardening` for any public input, and the matching reviewers before landing.

## Decision

Replace configurable themes with four finished templates in the brand kit, and put every public page on the forms publish model with versions, keeping operational switches instant.

## Feature design

- Contracts: `PAGE_TEMPLATES = ['classic','studio','night','split']`; `BrandKit.template`; `PageLook = { template, avatar: 'circle'|'rounded', cover?: path }` replaces `PageTheme` for new writes (old `PageTheme` parsed only by the migration).
- Rendering: each public entry (`public-booking`, `public-form`, link page, `public-menu`, business and event pages) reads `data-template` on its root from the `look.css` route; the four templates are CSS custom property sets plus a small number of layout variants (Split's two columns, Studio's cover header) in the library's page modules (`LinkPage`, `BookingFrame`, `HostedForm`, `MenuList`). No template code in apps.
- Drafts: one pattern for all page kinds, `page_versions (workspace_id, page_kind, page_id, version, snapshot jsonb, published_by, published_at)` plus a `draft jsonb` and `draft_changed_at` on each page row; the live columns are filled from the published snapshot on publish (so existing reads keep working while they move to snapshots). Forms keep their own tables.
- Changes list: a pure `diffPage(kind, published, draft)` in core returning plain sentences, unit tested per kind.

## Phase plan (owner: "phase this out, plan it out")

| Phase | What | Specs | Notes |
|---|---|---|---|
| P0 | Land what is built: form retention and the intake template; booking rules (0062 L1); the specs | 0023, 0063, 0062 L1, 0065 to 0068 | in CI now |
| P1 | Professional pages: the four templates and Publish for link and booking pages | 0068 | first, because every later page is born on it |
| P2 | Business base and Menu: apps, business profile, places, resources; Menu; Menu QR; import from checklabs | 0065 H0, H1, H2, H6 | H0 and H1 being built |
| P3 | Visit engine and online booking: engine, services, staff, shifts, booking flow | 0066 B0, B1, B2 | |
| P4 | Front desk and public presence: calendar, business pages, Table seating | 0066 B3, B4, B7 | SN can go live on menu, page and reservations here |
| P5 | Clinics and trust: several services, intake and sensitive services, reviews | 0066 B5, B6 | |
| P6 | Events and classes | 0066 B8 | |
| P7 | Analytics across products | 0067 | |
| P8 | Booking link leftovers: email words and follow ups (0062 L2); lengths, seats and repeats (0062 L4); Stripe, Twilio and Zoom (0062 L5, switched on when keys are added); 0037 L10 mediums; the editor's lockup logo preview | 0062, 0037 | Stripe and Twilio unlock deposits, no show fees, ticketing and text reminders across P3 to P6 |

Each phase lands in cars with full CI, reviews (security, design, UX, state) and screenshots in the real layout, and a live check of both productions after landing.

## Consequences

- Fewer choices, better pages: the theme editor shrinks to a template picker plus accent, logo and cover.
- Every public page type shares one draft, publish and version pattern; the slot engine reads published snapshots.
- Existing pages change look once (mapped), with a note to the owner.

## Follow-up

- More templates only when a vertical needs one, held to the same bar.
- Scheduled publish (publish at a time).
