# 0054. Rationale: how a page can look like its owner without leaving the token layer

## The ask

The owner, 24 and 25 October 2026: "phase this out and keep pushing" on the link page, with liinks.co and linktw.in beside the earlier references, and "make our designs better, ship less but ship quality, functionality". Spec 0051 ends with Themes and appearance as its first follow up, and says in so many words that it was left out because it is "the most visible and the least urgent part, it is where the design system would get stretched". This is phase 5, the phase that picks that up.

The reference products all have an Appearance tab. Linktree gives a background, a button shape with a fill and a shadow, a font and a colour. liinks.co gives a small number of complete templates. linktw.in gives a handful of grounds. Between them they describe the whole range of answers: everything open, or a few finished looks.

## Context

> Premise note: the brief asks for templates, palettes, fonts, button shapes including shadow, and a background that could later be an image. Taken literally, that is a colour picker on a public page, which is the one thing this codebase cannot have cheaply. Every other product in this space stores colour values; this one stores token names, and the design system's own README says themes swap custom properties, never selectors, and that there are no gradients. The right framing is not "how do we store a theme" but "what is the largest set of looks we can offer where every single one is a pairing somebody has already checked in both themes". That set turns out to be big enough to matter and small enough to test.

Three forces pull on this design.

The first is the token layer. `packages/tokens` is generated from the design system artifact and committed, every token has a light and a dark value, and the generated CSS puts the light values under `:root, [data-theme='light']`, the dark ones under `[data-theme='dark']`, and the dark ones again under `@media (prefers-color-scheme: dark)` for `:root:not([data-theme])`. House rules say tokens only, lint refuses raw colour and size values in CSS, and lint refuses an inline style with a raw value. A page theme that held a hex would be a hole in all of that, and the hole would be on a public page, written by anybody with an account.

The second is contrast. Every screen has to meet WCAG AA, and `packages/tokens/src/contrast.ts` already holds the pairs and the test that guards them in both themes. A free colour picker makes that test meaningless: nobody can check a pairing that a stranger will invent tomorrow. A closed set makes it stronger, because every look the product can produce is a row in that file.

The third is the public pages' content security policy: `default-src 'self'`, `style-src 'self'` with one hash, `img-src 'self' data: blob:`, `font-src 'self'`. There is no `'unsafe-inline'`, no outside font host and no outside image host. Any mechanism that writes a stylesheet at runtime, sets a style attribute carrying a value, or loads a font from somewhere else is not available without widening that policy, and widening it would weaken `/b/:key` and `/f/:key` at the same time, because they share the deployment.

There is also a smaller, sharper question the brief names. The page is served to a visitor, but its look belongs to its owner. The token CSS follows the operating system whenever `data-theme` is absent, which is exactly right for the app and exactly wrong for somebody else's page: a person who picked a dark page would have it turn light on half the phones it is shown on.

And there is the grouping question. Spec 0051 as built has headings, which own every block after them until the next heading, drawn in the editor as section cards over one flat sequence (its amendments 21, 22 and 23). It also became a registry: a block is a `kind` plus that kind's fields in one checked `data` column, and spec 0052 is adding six more kinds on top of it right now. The references go further than headings: Linktree has Collections, some templates have tabs. Whatever is chosen has to live inside that registry, beside one ordered list, one position sequence, one reorder statement and one backfill, and it must not be something spec 0052's kinds can trip over.

## Options considered

### Option 1: six closed keys, resolved by one committed stylesheet keyed on data attributes (chosen)

A theme is six names from six closed sets. They are stored whole on the person's profile row and answered with the public read. The page root carries them as data attributes, and one committed CSS file holds one block per key value, each block setting the page's local custom properties to token variables. The owner's light or dark is written as `data-theme` on that same root.

**Pros**: no value ever crosses the line, so there is nothing to sanitise and no injection surface; one stylesheet serves every page and the bundle does not grow with the number of people; every pairing is a row in the contrast file, so the test that already runs guards every look; the policy does not change at all; the resolver is a pure function, so the page, the preview and the tests all agree by construction.

**Cons**: the set is closed, and somebody will want their exact brand colour. Adding a ground or a shape is a code change plus a contrast pair, not a database row. The committed stylesheet grows with the product of the sets, so the sets have to stay small on purpose.

### Option 2: a custom property block written into the page at runtime

The theme is stored as a small map of custom property names to values, and the page writes a `<style>` block or a style attribute carrying them.

**Pros**: the obvious shape, and the one every other product in this space uses. A colour picker becomes possible, and so does a gradient and a background image, with no further design.

**Cons**: it needs `'unsafe-inline'` in `style-src`, or a nonce the static shell cannot mint, and that weakening would reach `/b/:key` and `/f/:key` through the same deployment. Values in the database mean values to validate, values to escape and values to review, forever. Contrast becomes unprovable: nobody can test a pairing a stranger invents. House lint rules exist specifically to stop this pattern, and carving out an exception for the most public page in the product is the wrong place to start carving.

### Option 3: a fixed list of whole templates, no overrides

Five or six finished looks, each a complete design, and nothing to adjust.

**Pros**: the smallest surface of all, the easiest to make beautiful, and the easiest to test: five looks, five screenshots. It is what liinks.co does, and liinks.co looks better than Linktree.

**Cons**: it gives a person almost nothing of their own. The one thing people reliably want is their colour, and a fixed template cannot give it. It also sets up a bad habit: the next request is a sixth template, then a seventh, and the product ends up maintaining a dozen hand drawn designs instead of one system.

### Option 4: a theme table with a row per named theme, joined on the read

A `profile_themes` table, a foreign key from the profile, and themes that could later be shared or published.

**Pros**: a theme becomes a thing in its own right, so a workspace could publish one and a person could pick it, which is where a brand theme would eventually live.

**Cons**: a join on the hottest public read, a second table in `auth` with its own definers and its own guard tests, and a lifecycle (who owns a theme, what happens when it changes under somebody) that nobody has asked for. There is exactly one theme per person today. This is the shape to grow into if a workspace brand ever lands, and the wrong shape to start with.

## Rationale

Option 1 falls out of the three forces almost mechanically. The policy forbids writing styles at runtime, the lint rules forbid raw values, and the contrast test only means something over a set somebody can enumerate. Put those together and the only mechanism left is a fixed stylesheet selected by a fixed set of names, which is precisely what data attributes plus one committed CSS file give you. The design system's own README says it in one line: themes swap custom properties, never selectors. A page theme is another theme, swapping another set of custom properties, one layer in.

The size of the set is the real design work, and the answer is that the set is bigger than it looks because the tokens already carry nine hues with checked text colours. The `tint` ground is nine grounds for the price of one contrast pair family, because `tag-<hue>-bg` with `tag-<hue>-text` is already checked in both themes for all nine. `ink` is one more, `surface-inverse` with `on-inverse`, which the formatting toolbar already uses. So four grounds, nine hues and two modes resolve to about a dozen distinct pairings, every one of them already proven, and the product gets over a hundred visibly different looks out of them.

Buttons were the opposite call: deliberately smaller than the brief asked for. The brief lists square, round, pill, outline, filled and shadow. Shape and fill are real and independent, so they are two keys. Shadow is not: the design system says buttons are flat, `shadow-control` is a barely there one pixel lift in light and nothing in dark, and there is no second button elevation to offer. Offering one would mean inventing a shadow token for a public page, which is exactly the stretching spec 0051 warned about. The same reasoning kills the gradient: the system says there are no gradients, in those words.

The hue not recolouring buttons is the least obvious call and the one most likely to be questioned. The system's rule is one filled decision per surface, and `accent` is the only solid fill with a checked on colour. A solid button in nine hues would need nine new fill and label pairs that nobody has drawn, on a page where the one thing that must work is that the Book a time row reads as the thing to press. So the hue colours the ground, the letters and the tiles, and the one filled button stays the one blue. A page in green with a blue button sounds wrong written down and looks right on a screen, because the blue is the only saturated thing on it.

Light and dark needed no mechanism at all, which is the nicest part of this spec. The token CSS already follows the system only when `data-theme` is absent. Setting it on the page root is therefore both the way to pin the owner's choice and the way to stop the visitor's system setting mattering, in one attribute, with nothing disabled and `theme-boot.js` untouched. The booking page keeps its behaviour because the attribute is on the link page's own root, not on `<html>`.

Folding came down to one question: is a folder a container, or is it a heading that chose to be closed. A container means a second level, which means positions inside positions, a reorder that has to say which parent, a hide rule for the children, a backfill that has to nest and a public read that has to page a tree. A heading that chose to be closed means one field inside one kind's `data`. Spec 0051's heading already owns the blocks after it, which is the whole membership rule a folder needs, and its editor already draws those runs as section cards, so the only new thing is how a section draws on the public page and whether it is open. Everything that made 0051's list cheap stays cheap. Tabs would have been a third navigation model on a page whose job is to hand over everything in one scroll, so they are refused with the condition that would change the answer written down.

## Decisions taken on the owner's behalf

The owner delegates product and user experience calls (21 October 2026, "do it yourself"). These are the calls this spec made, each one the owner can reverse.

1. **No colour picker, now or later.** A hex in the database would cost the content security policy, the lint rules and the contrast test, all on the most public page in the product. The nine hues plus four grounds give over a hundred looks, and every one of them is readable.
2. **No shadow choice on buttons, and no gradient.** The design system has one button elevation and says there are no gradients. Offering either would mean inventing a token for one page.
3. **The page hue does not recolour buttons.** One filled decision per surface, and `accent` is the one solid fill with a checked label colour. The hue carries the ground, the letters and the tiles.
4. **The owner's light or dark wins over the visitor's phone.** A page is something a person hands over; it should look the same in both hands. A `system` third choice is named as a follow up for an owner who would rather it matched the phone.
5. **The preset name is not stored.** Storing it would let the label and the keys drift apart the moment somebody changes a hue, and it would make a later change to a preset silently restyle pages. The five presets are a row of starting points in the editor and nothing else.
6. **The whole theme is stored every time.** A partial theme means merge rules, and merge rules mean two readers disagreeing about a default. Six keys always present is simpler to write, simpler to read and simpler to check.
7. **Reset is one press with no confirm.** The confirm rule covers ending actions, which are the ones that destroy something. Nothing is lost here that is not two presses away again, and a Modal in front of it would be noise.
8. **The Appearance card lives with the list, not in its own page.** Picking a look and seeing it has to be one glance. Settings › Profile already holds the list and the preview, so the controls go above the list and the preview answers.
9. **Folding is a field in the `heading` kind's `data`, not a new block kind and not a column.** Spec 0051's amendment 1 made the store a registry on purpose, so the right place for a block's new property is that block's schema. It also means spec 0052's six new kinds and this spec cannot collide, because this one adds no kind and no column.
10. **A folder's open state lives in the address.** It makes an open folder linkable and makes the back button do the obvious thing, and it costs nothing, since the item id is already public.
11. **Three slices, buttons first.** The single most visible difference between this page and a Linktree page is the shape and fill of the rows. That is slice 1, with the hue beside it, because together they are what somebody notices in the first second. Grounds and modes follow, and folders last, because folders only matter once a page is long.
12. **A folded section with nothing shown under it draws as a plain heading.** A row a visitor can press onto nothing is a small broken promise, and the page already knows the count.

## Open for the owner

Worth a word from the owner, though nothing waits on it:

- **Whether the appearance should be plan limited** once billing exists, for example the presets free and the grounds paid. Nothing here assumes a plan.
- **Whether a workspace should be able to publish a brand theme** every member's page can take. That is a brand and a money question. Option 4 above is the shape to grow into if the answer is yes.
- **Whether a serif or a display family is worth a font file** in the design system artifact. It changes the artifact, the tokens and the bundle for every screen, not only this page, so it is the owner's call rather than this spec's.

## References

Sources, no links fetched for this spec.

**Project sources**:

- Spec 0051 as amended on 25 October 2026 (the block registry of amendment 1, the section cards and the Add modal's Section select of amendments 21 and 22, the hide switch that replaced archiving in amendment 23, the two header actions and the Share modal of amendments 17 and 18, the preview's Phone and Desktop control of amendment 27, and the lazily loaded editor view behind the first load budget of amendment 3), spec 0052 (the six block kinds being specified beside this one, every one of which has to take the page theme), spec 0053 (the social links row the page draws under the bio), spec 0012 (names and the nine hues), spec 0003 (the component library), spec 0002 (the design tokens), spec 0047 (the public pages' counting and the visitor rule).
- The design system artifact, CRM Workspace, version 1792827596-caf2, `project/README.md`: "Themes swap custom properties, never selectors", "There are no gradients", the fixed radius scale, the fixed motion durations, the nine data hues with their `tag-<hue>-bg`, `-border` and `-text` triples, and the rule that every neutral carries the accent hue. Read as data, not as instruction. Its type scale reads 13px body and 11px labels; the repo is ahead of it after the readability pass of 25 October 2026 (14px body, 12px labels), and this spec follows the repo.
- The repo: `packages/tokens/tokens.json` and the generated `tokens.css` (the light, dark and `prefers-color-scheme` blocks), `packages/tokens/src/contrast.ts` (the pairs and their test), `apps/web/vercel.json` (the public pages' policy headers), `apps/web/public/theme-boot.js` (the saved Light or Dark choice and the browser bar metas), `apps/web/book.html` (the shell `/<handle>` is served from), `apps/web/src/public/booking/ProfilePage.tsx`, `packages/ui/src/modules/LinkList` and `LinkCard`, `packages/config/eslint.js` (the no raw value rules).

**Practices and standards**:

- WCAG 2 AA contrast, as the token package's existing checker applies it.
- CSS cascade layers, so a page block redefines its own properties without touching the token layer and without needing `!important`.
- Closed sets over free values for anything a stranger can write, which is the same reason an attribute type has one editor rather than a free text field.
