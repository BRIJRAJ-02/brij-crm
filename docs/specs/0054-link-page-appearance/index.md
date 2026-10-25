# 0054. The link page's appearance

**Date**: 2026-10-25
**Status**: Proposed

**Numbering**: 0054 taken by the appearance and sharing lane on 25 October 2026. 0049 and 0050 are claimed by the planning chat, 0051 is the link page, 0052 is more link page blocks and 0053 is social links, all taken by the `spec-blocks` lane the same day. This spec owns AC-5401 to AC-5499, and spec [0055](../0055-link-page-sharing/index.md) is its other half.

## Summary

The link page at `/<handle>` gets a look its owner chooses: a ground, a hue, light or dark, a button shape, a button fill and a typeface. Every one of those is a name from a closed set, never a colour or a size, so the database never holds a hex value and the page never grows new CSS per person. The page's light or dark is the owner's call, not the visitor's system setting. The `heading` block gains one extra way to draw, as a section that is folded shut until a visitor opens it, which is the whole of the grouping work: no tabs, no second navigation and no new kind of block. It is one field inside that kind's `data`, so spec 0051's block registry gains nothing and spec 0052's new kinds cannot collide with it.

Reasoning, options and the calls taken on the owner's behalf: see [rationale.md](rationale.md). How to check it: [verify.md](verify.md).

## Requirements

**User stories**:

- As the owner of the page, I want my page to look like mine and not like a settings screen, so handing it over feels like handing over something I made.
- As the owner of the page, I want to pick a look in a few presses and see it at once, so I never publish to find out what it looks like.
- As the owner of the page, I want my page to stay the colour I chose on anybody's phone, so what I show somebody at an event is what they see.
- As the owner of the page, I want to put my work links behind one row and my personal ones under another, so a visitor reads six rows instead of twenty.
- As a visitor, I want the page to be as readable on a phone in sunlight as any other page, so a strong colour never costs me the words.
- As the person who keeps the design system, I want a page theme to be a handful of named choices, so a thousand pages are still one stylesheet and one contrast test.

**Acceptance criteria**

*The theme and where it lives*

- **AC-5401**: A person's page theme is six keys, every one of them required and every one of them a name from a closed set: `ground` (`plain`, `paper`, `tint`, `ink`), `hue` (the nine of spec 0012: gray, red, orange, yellow, lime, green, sky, blue, purple), `mode` (`light`, `dark`), `shape` (`soft`, `pill`, `square`), `fill` (`plain`, `soft`, `outline`, `solid`) and `font` (`sans`, `mono`). The whole record is stored every time, so a read never merges a partial theme with a default. A person who has never touched it reads the default: `plain`, `blue`, `light`, `soft`, `plain`, `sans`.
- **AC-5402**: No colour, size, radius, font stack or duration is ever stored. A key outside its set, a missing key or an extra key is refused with `CONFIG_INVALID`, "That isn't one of the looks you can pick.", by the `PageTheme` Zod schema on the server before anything is written, not only in the browser.
- **AC-5403**: The theme is a `theme jsonb` column on `auth.public_profiles`, written by `crm_save_profile_theme(owner uuid, theme jsonb)` and read by the reads that already read that row. `crm_app` holds no grant on the table; the definer is owned by `crm_handle` with a fixed `search_path`, and a guard test proves it.
- **AC-5404**: `GET /api/public/handles/:handle` answers the theme beside the person, in the same read, with no extra statement. The answer carries the six keys and nothing else: no colour value, no workspace id, no member id.

*How it reaches the page*

- **AC-5405**: The theme reaches the DOM as six data attributes on the link page's own root element (`data-page-ground`, `data-page-hue`, `data-page-mode`, `data-page-shape`, `data-page-fill`, `data-page-font`). One committed CSS file, in the `components` layer, holds one block per key value, and each block sets the page's local custom properties to token variables. There is no inline `style`, no style attribute, no generated stylesheet, no `<style>` written at runtime and no CSS added when a person picks a look. The content security policy is unchanged, including its `style-src` hash.
- **AC-5406**: The page root carries `data-theme` set to the owner's `mode`, so the token layer's `@media (prefers-color-scheme: dark)` block, which only applies to `:root:not([data-theme])`, never decides a link page. A visitor whose phone is dark sees a light page when the owner chose light, and a visitor who once chose Dark in this app sees the owner's choice on `/<handle>` too, because the page root's attribute wins over the root element's for everything inside it. `theme-boot.js` keeps doing exactly what it does for `/b/:key` and the app, and is not changed.
- **AC-5407**: Every colour pairing a theme can resolve to is already a pair in `packages/tokens/src/contrast.ts`, or is added to that file in the same change, so the existing contrast test fails in either theme before a pairing below WCAG AA can ship. No preset introduces a pairing that file does not hold.
- **AC-5408**: The four grounds resolve to tokens only: `plain` is `surface` with `text`, and cards on `surface-raised` inside a `border` hairline; `paper` is `surface-subtle` with `text`, and cards on `surface-raised` under `shadow-xs`; `tint` is `tag-<hue>-bg` with `tag-<hue>-text`, and cards on `surface-raised`; `ink` is `surface-inverse` with `on-inverse`, and cards on `inverse-hover`.
- **AC-5409**: The three shapes are the radius scale and nothing else: `soft` is `radius-md`, `pill` is `radius-full`, `square` is `radius-xs`. The four fills are existing pairs: `plain` is the row as the page draws it today, `soft` is `accent-soft` behind `link` text, `outline` is a `border-width-hairline` line in `accent-border` with `link` text, and `solid` is `accent` behind `on-accent`. There is no shadow choice: the system has one button elevation (`shadow-control`), and the page uses it.
- **AC-5410**: `font` picks a family the repo already ships and self hosts: `sans` is Inter everywhere, `mono` puts JetBrains Mono on the person's name and on item titles while sentences stay in Inter. `font-src 'self'` is unchanged and no font is fetched from anywhere.
- **AC-5411**: `hue` colours the `tint` ground, an item's letter avatar and an object tile, exactly as spec 0012's hues already do. It never recolours a button: a `solid` button is `accent` on every ground, because the system allows one filled decision per surface and `accent` is the one solid fill with a checked contrast pair.
- **AC-5412**: There is no gradient, no background image and no custom colour in this spec. The design system says there are no gradients, and a page keeps that.
- **AC-5413**: Before the profile read answers, the page draws its loading state on the plain ground in the visitor's own light or dark, with the row shapes in place. The theme lands with the content, in one step, with no transition and no second paint of a different colour. The browser bar's `theme-color` metas are set to the resolved mode's `surface` value once the theme lands, by the same code path `theme-boot.js` uses.
- **AC-5414**: Motion on the page is unchanged: the house durations and easings, nothing past 300ms, and reduced motion still drops movement and keeps fades. A theme never adds an animation.

*Folders*

- **AC-5415**: The `heading` kind's `data` gains one field, `group`, which is `open` (the small heading the page draws today) or `folder`. It goes in `data jsonb` and into that kind's Zod schema inside the `ProfileBlock` union, checked by `crm_check_profile_item` like every other block field (spec 0051 amendment 1). It is not a new kind, not a new column and not a level above the list: the blocks under a heading are still the blocks after it until the next heading, the order is still one flat sequence (spec 0051 AC-5137), and spec 0051's limits, reorder statement, hide rule and backfill are untouched. A read that meets an unknown `group` value treats it as `open`, so an older client never breaks on a newer page.
- **AC-5416**: A folded section draws as one row carrying the heading's text, a chevron and the count of live blocks under it, in the same row shape the page already uses, with its icon tile on the quiet surface and its chevron as the quiet mark every staying row ends in (spec 0051 AC-5109). Pressing it opens those blocks in place, under the row, and pressing again closes them. It is a real `button` with `aria-expanded` and `aria-controls`, reachable and operable by keyboard, and the open state is announced.
- **AC-5417**: An open section puts `#<block id>` in the address, so a person can link straight to an open section and the back button closes it. A page opened at that address opens that section and scrolls it into view. An address naming a block that is not a live folded heading is ignored and the page draws normally.
- **AC-5418**: With the search in play (spec 0051 AC-5133, which shows after more than eight rows and does not count headings) the page still shows matches flat and counts them: a folded section never hides a match, and a match inside a closed one is shown.
- **AC-5419**: A folded section with no shown block under it draws as a plain heading, never as a folder a visitor can open onto nothing. A heading whose own switch is off takes its blocks with it exactly as spec 0051 AC-5106 says, and nothing about folding changes that.

*The editor*

- **AC-5420**: The link page editor (Settings › Account › "Your link page", the lazily loaded view at `?view=link-page`, spec 0051 AC-5116) gains an Appearance card above the section cards, holding five controls built from library components only: Ground, Hue, Light or dark, Buttons (shape and fill) and Typeface. Five named starting points (Plain, Paper, Bold, Ink and Quiet) sit above them as a row of presses; picking one writes all six keys, and the person may then change any of them. The preset's name is never stored, so nothing can drift out of step with the keys that draw the page.
- **AC-5421**: Each pick saves at once, the same way a reorder does. A refusal puts the control back where it was and says why, and nothing on the page is left showing a look that was not saved.
- **AC-5422**: The preview beside the list (spec 0051 AC-5119, two fifths of the width, its Phone and Desktop control, no "Powered by" foot) shows every pick before it is saved, drawn by the same public page components with the same resolver, so what the preview shows is what a visitor gets. The theme applies in both frame widths. When the column is too narrow for both, the preview is still behind the Preview button and the Appearance card still sits with the list.
- **AC-5423**: Reset puts the theme back to the default in one press, with no confirm. It is not an ending action: nothing is lost that is not two presses away again, and the preview shows the result at once.
- **AC-5424**: The editor's own chrome, the app's screens and every other surface in the product never take a page theme. The theme's custom properties exist only inside the link page root and inside the preview frame, and a guard test proves no app screen reads them.
- **AC-5425**: Every Appearance control has a visible label, a visible focus ring, a reachable keyboard path and an accessible name that says what it changes. The current value is announced, not only shown as a colour.

*Keeping what already works*

- **AC-5426**: `/b/:key` is untouched: no new request, no new markup, no change to its policy headers and no page theme. A guard test fails if the theme module or its stylesheet is imported by the booking page's entry.
- **AC-5427**: A person who has never opened the Appearance card sees exactly the page spec 0051 ships, because the default theme resolves to the tokens the page uses today.
- **AC-5428**: The theme covers every part of the page spec 0051 and spec 0052 draw, with no part left on an unthemed colour: the person's card and bio, the socials row (spec 0053), the two header actions (spec 0051 AC-5134), every block kind's row including the ones spec 0052 adds, the search, the empty, loading and failed states, and the "Powered by timefix" foot. A block kind that arrives later takes the theme by using the page's own custom properties rather than token variables directly, and a house rule check fails a block that reaches past them.
- **AC-5429**: Save contact stays the one filled action on the page in every theme (spec 0051 AC-5134), whatever `fill` the rest of the rows take, because a page with no filled control has nothing that reads as the thing to press.
- **AC-5430**: The page's first load budget is unchanged in kind: the theme adds one stylesheet to the public bundle and no script, the Appearance card and its controls live only in the lazily loaded editor view, and `pnpm size` passes.

## Decision

**Chosen option**: Option 1 in the rationale. A page theme is six closed keys on the person's profile row, resolved to token variables by one committed stylesheet keyed on data attributes, with folders as a property of the heading item rather than a new kind of block.

**Implementation skills**: the house skills `crm-design-system` (every screen, the tokens and the component rules), `crm-frontend-state` (the editor through the one data layer), `crm-data-model-access` (the column, the definer and the door) and `crm-api-backend` (the read and the write); plus `zod`, `drizzle`, `vitest`, `modern-css-html` and `emil-design-eng`.

- **Where the theme lives**: a `theme jsonb` column on `auth.public_profiles`, beside the bio and the handle, because there is exactly one theme per person and the public read already reads that row. No new table, no join, no second statement.
- **What a theme is**: six names, never values. The closed set is the contract: a key the set does not hold is refused on the server, and because there are no values there is nothing to sanitise, nothing to inject into CSS and nothing to review per person.
- **How it draws**: data attributes on the page root, matched by one committed CSS file in the `components` layer, which the stylesheet orders after `tokens`, so each block redefines the page's own custom properties from token variables. Nothing is written at runtime and the policy does not change.
- **Light and dark**: the owner's choice, written as `data-theme` on the page root. The token layer only follows the system when no `data-theme` is set, so pinning it is enough; nothing has to be disabled.
- **Grouping**: one extra way for a heading to draw. Tabs and collections are refused here and named as follow ups, with the condition that would justify them.
- **Contrast**: the token package's contrast pairs are the gate. A preset may only use pairs that file holds, and a new pairing is added there in the same change, so the test that already runs guards every look in both themes.

## Feature design

**Data model** (one migration, `NNNN_profile_theme`, at the next free number; `0097_social_links` is taken and `0098` was free when this was written):

| Object | Schema | Change |
|---|---|---|
| `public_profiles` | `auth` | `theme jsonb` (not null, default the plain theme object), validated by `PageTheme` before every write. A check constraint keeps it an object with exactly the six keys. |
| `profile_items` | `auth` | no column change. The `heading` kind's entry in the `ProfileBlock` union gains `group` inside the existing `data jsonb`, and `crm_check_profile_item` checks it there, exactly as it checks every other block field (spec 0051 amendment 1). |

`PageTheme` (in `packages/contracts`, one schema and one type of the same name):

```
PageTheme = { ground, hue, mode, shape, fill, font }
```

every field a Zod enum of its closed set, every field required, no `null` and no unknown key (`.strict()`).

**State transitions**: none. A theme is a value that is replaced whole; there is no draft, no publish step and no history.

**Definers** (owned by `crm_handle`, `search_path = pg_catalog, pg_temp`, execute granted to `crm_app` only):

| Function | Answers or does |
|---|---|
| `crm_save_profile_theme(owner uuid, theme jsonb)` | Replaces one person's theme, whole, and answers it back. Raises `22023` on an object the check constraint refuses. |
| `crm_handle_owner(handle text)` | Extended to answer `theme` beside the person it already answers. No new statement on the public read. |

**API surface**:

| Endpoint or procedure | Input | Output | Auth | Key errors |
|---|---|---|---|---|
| `GET /api/public/handles/:handle` (exists) | `after?`, `q?` | the person, the theme, one page of items | public, limited as today | 404 for an unknown handle |
| `profile.theme` | | `PageTheme` | session, own account | |
| `profile.saveTheme` | `PageTheme` | `PageTheme` | session, own account | `CONFIG_INVALID` |
| `profile.saveItem` (exists) | `ProfileItemInput` plus `group` for a heading | `ProfileItem` | session, own account | `CONFIG_INVALID` for `group` on another kind |

Every `profile.*` procedure acts on the caller's own account; the owner's user id comes from the session and is never an input.

**Value sourcing**:

| Action | Value produced or displayed | Source |
|---|---|---|
| Public read | the six theme keys | the `theme` column, through `crm_handle_owner` |
| Public read | the person's name, picture, items | spec 0051, unchanged |
| Draw the page | the ground, the card surface and the text colour | `resolveTheme()` in `packages/core/src/profile/theme.ts`, a pure function from the six keys to a set of token variable names, used by the page, the preview and the tests alike |
| Draw the page | the actual colour behind a token name | `packages/tokens/tokens.css`, never the database |
| Draw the page | which light or dark applies | the `mode` key, written as `data-theme` on the page root |
| Draw the page | the browser bar colour | the resolved mode's `surface` token, the same value `theme-boot.js` uses |
| Draw a row | its button shape and fill | the `shape` and `fill` keys, mapped to `radius-*` and the accent tokens by `resolveTheme()` |
| Draw a row | its icon tile and letter colour | the block's own `hue` (spec 0051), not the page `hue`, so a block keeps its colour when the page's changes; the tile's ground follows the page ground, and a booking page keeps its accent soft tile (spec 0051 AC-5109) |
| Draw the ground on `tint` | the tint | the page `hue`, as `tag-<hue>-bg` with `tag-<hue>-text` |
| Draw a folded section | the count on the row | the shown blocks between this heading and the next, counted on the client from the page already read, never a second request |
| Draw a folded section | whether it is open | the address fragment, else closed |
| Editor | which preset is shown as picked | compared on the client against the five preset objects; nothing stored |
| Editor | the preview | the same `resolveTheme()` fed by the unsaved draft |

**Key invariants**:

- A stored theme always holds all six keys, each from its set. There is no partial theme and no `null` key.
- No colour, size, radius, font stack or duration value is ever stored, transferred or written into the DOM by this feature.
- A theme's custom properties exist only inside the link page root and the preview frame. Nothing outside them can read a page theme.
- Every pairing a theme can resolve to is in the token package's contrast pairs.
- `group` exists only inside a `heading` block's `data`, and `crm_check_profile_item` refuses it anywhere else.
- A folded section's membership is the membership spec 0051 already defines: the blocks after that heading until the next one. There is no second store and no nesting.

**Security model**:

- **Read**: the theme is public, because the page is. It says nothing about the person beyond what they chose to look like.
- **Write**: only the signed in person, for their own account, through the definer. No workspace role grants it and no admin path reaches another person's theme.
- **Untrusted input**: the only input is six names from closed sets, parsed by Zod on the server and held by a database check constraint. Because no value ever crosses the line, there is no CSS injection surface at all: the worst a hostile write can do is fail.
- **Tenancy**: `auth` sits outside the tenant fence, as spec 0051 settled. The theme holds no tenant data.
- **Policy**: no new origin, no inline style, no runtime stylesheet, no new font and no image fetch. The public pages' content security policy is byte for byte what it is today.

**Configuration required**: none. No new environment variable, no new credential, no new dependency.

**Critical test scenarios**:

- Happy path: a person picks Bold, changes the hue to green and the buttons to pill outline; `/<handle>` draws exactly that in a private window, and the editor's preview showed it before the save, verifies AC-5401, AC-5405, AC-5409, AC-5420, AC-5422.
- Failure case: a write with `ground: "#ff0000"` is refused by the schema and by the check constraint, and nothing is stored, verifies AC-5402.
- Failure case: the theme read is slow; the page draws its loading state on the plain ground and then the themed page in one step, with no second paint of a different colour, verifies AC-5413.
- Visitor independence: a visitor on a dark phone, and a visitor who chose Dark in this app, both see a light page when the owner chose light, verifies AC-5406.
- Contrast: a preset is changed to a pairing that is not in `contrast.ts`; the token package's contrast test fails, verifies AC-5407.
- Auth and permission: an admin of the person's workspace calls `profile.saveTheme`; their own theme changes and the other person's does not, verifies the security model.
- Tenancy: a direct `update auth.public_profiles set theme` as `crm_app` is refused, verifies AC-5403.
- Policy: the page loads with no console policy violation, no `style` attribute on the page root and no request to any outside origin, verifies AC-5405 and AC-5412.

## Build plan

Tracer Bullet: slice 1 is one thin thread through every layer, and each slice after it is shippable on its own. Slice 1 is deliberately the smallest change that makes the page look like somebody made it: the buttons and the hue, which is what a visitor sees first.

**Slice 1: buttons and hue, end to end** (AC-5401 partly, AC-5402, AC-5403, AC-5404, AC-5405, AC-5407, AC-5409, AC-5411, AC-5420 partly, AC-5421, AC-5422, AC-5424, AC-5427)

1. The migration: the `theme` column with its default and check constraint, and `crm_save_profile_theme`. Guard test for the grant, the owner and the fixed `search_path`.
2. `packages/contracts`: `PageTheme`, folded into `PublicProfile`.
3. `packages/core/src/profile/theme.ts`: `resolveTheme()`, pure, from six keys to token variable names, with its unit tests.
4. `apps/api`: `profile.theme` and `profile.saveTheme`, and the public read answering the theme.
5. `packages/ui`: the one committed stylesheet keyed on the data attributes, and the page root taking them. The contrast pairs the shapes and fills need added to `packages/tokens/src/contrast.ts`.
6. `packages/data` plus `apps/web` Settings › Profile: the Appearance card with Buttons and Hue only, saving at once, and the preview reading the unsaved draft.

**Slice 2: the grounds, the modes and the presets** (AC-5401, AC-5406, AC-5408, AC-5410, AC-5413, AC-5414, AC-5420, AC-5423, AC-5425, AC-5426)

1. The four grounds and their contrast pairs, and the `font` key.
2. `data-theme` on the page root from the `mode` key, and the browser bar metas from the resolved mode.
3. The loading state on the plain ground, with no second paint.
4. The five presets, Light or dark, Ground, Typeface and Reset in the Appearance card, with their labels, focus and announcements.
5. The guard test that the booking page and the app screens never take a page theme.

**Slice 3: folded sections** (AC-5415, AC-5416, AC-5417, AC-5418, AC-5419)

1. `group` in the `heading` kind's schema and in `crm_check_profile_item`, carried by `profile.saveItem` like any other block field. No column, no migration beyond the check function.
2. The folder row on the public page, with its chevron, count, keyboard path and announcement.
3. The address fragment that opens a folder, and the back button that closes it.
4. The editor: a section card's menu (spec 0051 AC-5136, beside Rename, Move up, Move down and Delete) gains "Fold on the page" and "Unfold on the page", and the preview shows it.
5. The empty folder rule and the search rule.

## Consequences

**Positive**:

- A page can look like its owner without the design system losing control of a single colour. Every look is a pairing somebody already checked, in both themes.
- Nothing per person is ever generated. One stylesheet serves every page, the bundle does not grow with the number of people, and there is no per person CSS to review.
- The light or dark question stops being ambiguous. The owner decides, and the mechanism is the one the tokens already have.
- Folding costs one field in one kind's `data` and one way of drawing. The order, the reorder statement, the limits, the hide rule and the backfill of spec 0051 are untouched, and spec 0052's new kinds cannot collide with it.

**Negative / tradeoffs**:

- The closed set will feel small to somebody who wanted their brand colour. Four grounds times nine hues is a hundred and some looks, and none of them is their exact pink. That is the price of a page that is always readable and never a security review.
- Until spec 0054's server rendered shell lands, the first paint is the plain ground and the theme arrives with the content. On a slow phone that is a visible step.
- Two surfaces now draw the same page: the public page and the editor's preview. They share one resolver and one stylesheet, but a change still has to be looked at in both.
- `auth.public_profiles` gains a json column with a check constraint, which is one more thing the security reviewer reads on every change to that table.
- The public bundle gains a stylesheet on a page whose first load budget had about ten bytes of headroom when the editor was moved into a lazily loaded view. The stylesheet is small and carries no script, but it is the reason the sets stay small and the reason `pnpm size` is a gate here rather than a formality.
- Every block kind now has to take its colours from the page's own custom properties rather than from token variables directly. That is one more rule for spec 0052's kinds and for every kind after them.

**Neutral**:

- The token package's contrast pairs become load bearing for a public page, not only for the app. That is the right place for them, and it makes the existing test do more work.
- `hue` on the page and `hue` on an item are different things with the same name. The spec names both; the code should keep them apart by name (`pageHue` and the item's own `hue`).

## Follow-up

Named, not built here:

- **A location line, a cover image or anything else the owner's boards add later** takes the theme the same way: through the page's own properties, never a colour of its own.
- **Tabs across the top of the page**: a second navigation model, worth revisiting only once pages regularly carry more than three folders and the owner can show that a visitor scrolls past the fold to find what they came for.
- **Collections**: a group that opens on its own address, the way Linktree does it. It needs its own public path, its own share card (spec 0054) and its own figures, so it is a spec, not a field.
- **A serif or a display family**: it needs a font file in the design system artifact and a tokens sync, because `font-src 'self'` means the repo has to hold it. Worth doing when there is a family the owner actually wants.
- **A background image**: it needs object storage (#32), an upload path, re-encoding and a `img-src` that still says `'self'`. Spec 0054 builds the storage pieces it would reuse.
- **A per item colour on the page**: an item that overrides the page's hue. Cheap once the resolver exists, and worth it only if people ask.
- **A light or dark that follows the visitor by the owner's choice**: a third `mode`, `system`, for an owner who would rather the page match the phone. Deliberately left out until somebody asks for it.

## Open for the owner

Decided here, and reversible by a word from the owner:

- **Whether the appearance should be plan limited** once billing exists, for example the presets free and the grounds paid. Nothing in this spec assumes a plan.
- **Whether a page should ever carry a workspace's brand** rather than a person's taste, for a team that wants every member's page to match. That is a brand and a money question, not a design one.
- **Whether a serif is worth a font file** in the design system artifact, which is the owner's call because it changes the artifact and the bundle for every screen, not only this page.
