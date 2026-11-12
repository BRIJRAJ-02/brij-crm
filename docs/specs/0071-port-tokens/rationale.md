# 0071 rationale: port phase 0, the Timefix type scale and tokens

## Context

The owner approved the Timefix prototype (`design/timefix-design-system`, merged in PR #4 at 3d4270a23) as the look of the whole product. The prototype draws every dashboard page at 88% with CSS `zoom` on `#root` and on each overlay layer (`scripts/standalone.mjs` line 68). It needed a build plugin that patches React Aria's popover placement to survive the zoom, and drag helpers that undo it. Public views (`html[data-guest]`) stay at 100%. The owner reached 88% by looking: 80% first, then "font can be 10% more" (11 Nov).

The real app cannot use zoom. It breaks placement maths in every positioned overlay, drag and drop, pointer coordinates, canvas measuring and container queries, and the real app has many more of those than the prototype. So "what the owner sees at 88%" has to become real values. That is the first decision every later port phase rests on: phases 1 to 9 will copy prototype CSS by the hundreds of rules, and each rule names prototype tokens.

The two token systems differ in more than scale. The real app (`packages/tokens/tokens.json`, synced 20 Oct from the older "CRM Workspace" artifact under spec 0002) and the prototype (`tokens.json`, grammar version 2) share most colour roles but differ in names, values, the type scale, fonts, motion and the size family. The prototype's own CSS also writes its fonts as raw shorthands (949 of them) and never uses its `--text-*` tokens, so its token file alone does not describe the look.

Constraints: spec 0002's generator, theme logic and lint rules work and stay; the house rules forbid raw values, press shrink and blur in motion; the CSP allows fonts from our own origin only; emails read `tokens.json` as data; visual baselines (2,694 PNGs) gate CI; and this session's account could not open the design system artifact by URL (it can open the Timefix app artifact, whose built CSS matches the repo source: `zoom: 0.88`, `--size-control: 36px`, `--space-16: 16px`, the canvas and focus ring colours).

## Options considered

### Option 1: Bake 88% into the source values

Rewrite the prototype's `tokens.json` in app pixels (body 12.5px, `space-16` → 14px, and so on), add separate `public-*` tokens for full size pages, and drop zoom from the prototype too.

**Pros**:
- What you read in the token file is what the app draws.
- No generator logic beyond today's.

**Cons**:
- The prototype's CSS (949 raw font shorthands, every `space-*` use) was drawn in full size units under zoom. Removing its zoom means converting the whole prototype first, which is the port's work done twice.
- Two parallel families (`size-control` and `public-size-control`) for every length; every public component chooses between them by hand, forever.
- Value named spacing breaks (`space-16` would be 14px, or renamed to `space-14`, and every ported rule translated).

### Option 2: One source in full size units, app scale generated (chosen)

Keep the prototype's source as it is. Add one token, `density-app` (0.88). The generator writes source values under `:root` and the rounded app values under `:root[data-scale='app']`; the app's HTML sets the attribute.

**Pros**:
- Prototype CSS ports with its names untouched; the scale comes from the attribute.
- One number drives both the prototype's zoom and the app.
- Public pages, emails and marketing get full size with no change.
- The rounding is code, tested value by value, not a hand kept table that drifts.

**Cons**:
- Token names are steps, not app pixels.
- The generator gains rules (height vs width list, rounding modes).
- The app is a few tenths of a pixel off the artifact here and there (rounding), so screenshot comparisons need a small tolerance.

### Option 3: Exact fractional scale with `calc()`

Every scaled token is `calc(16px * var(--density))`, with `--density` 0.88 in the app and 1 on public pages.

**Pros**:
- Matches the artifact exactly, including its fractional sizes.
- No rounding rules.

**Cons**:
- Fractional row heights (38.72px) blur hairlines at 1x and accumulate in the virtualised table's offsets.
- Stylelint and the email reader see `calc()` strings instead of values.

### Option 4: Snap to a new hand tuned scale

Pick a fresh whole pixel scale that "feels like" 88% (for example body 13px, label 11px, a 4px spacing grid kept).

**Pros**:
- Familiar round numbers; close to today's real app.

**Cons**:
- Not what the owner approved; every screen drifts from the artifact by a different amount, so side by side reviews stop working.
- Still needs a mapping table for every ported rule.

## Rationale

The port is nine phases of copying prototype CSS. The decision that makes those phases cheap and safe is the one that lets the CSS move with its names intact, and Option 2 is the only one that does: the scale lives in one attribute and one number, not in the names. Option 1 front loads a full prototype rewrite and leaves two families forever. Option 3 is exact but trades away whole pixel rows, which the table virtualiser and 1px hairlines need. Option 4 abandons the approved look.

Rounding fonts to half pixels rather than whole ones is deliberate. Whole pixels merge the prototype's 12px and 13px steps (both become 11px) and its 13px and 14px steps are only one pixel apart after that, so hierarchy collapses. Half pixels keep all eleven steps distinct and within 0.2px of the artifact. Font size is the one length where a fraction costs nothing: text is drawn as outlines at any size. Box lengths are whole, and heights are even so text centres on a whole pixel.

Default to full size, opt the app in. The app is one HTML file; public pages are six entries plus embeds and the marketing site, and new ones keep coming (hospitality, partner embed). A forgotten attribute should give the bigger, safer result, never a shrunken public page.

Names follow the prototype because the prototype is where the next nine phases copy from. Where the real app's name means the same role, the prototype's value wins. Where only the real app has a token and a screen still needs it, it goes to `legacy.json` at its shipped value so phase 0 does not redesign components; each port phase deletes its share. Swapped names (`heading` and `title`, `size-control` and `size-input`) are renamed by role, not by name, which is why the map is data in a script and runs through placeholders.

Motion: the prototype's CONVENTIONS already honour both house rules (no blur in motion, no press scale; scales only for surfaces opening and closing) and its CSS uses no `--blur-*` at all. So the blur family is not ported and `scale-press` disappears rather than staying a token that must equal 1. The real app's role names map by the prototype's own usage table (hover and press → quick, popover, modal and move → fast). The tuned `public-*` durations fold into the same scale, because the prototype's guest pages, which the owner approved, use it.

The source moves from the old CRM Workspace artifact to the repo folder the Timefix artifacts are published from. Keeping 0002's "byte copy plus check" shape means emails and Stylelint keep reading `@crm/tokens/tokens.json`, and drift between the folder and the package fails CI instead of going unnoticed.

Geist was decided by the owner on 10 Nov ("use"). It is served from our origin because the CSP allows nothing else, from Fontsource's Latin variable files like the link page packs.

## Evidence

### Prototype font shorthands by use (its CSS, 949 in all)

400 14/20 (160), 400 13/20 (148), 500 14/20 (109), 500 13/20 (108), 500 12/16 (91), 400 12/16 (61), 400 13/18 (40), 500 15/22 (38), 500 16/24 (21), 600 15/22 (17), 500 11/16 (16), 500 24/32 (15), 400 16/24 (13), 500 13/18 (11), 500 18/26 (10), then 25 combinations under 10 uses each. Styles were added for every combination at 15 uses or more; the prototype's own eleven cover the rest of the common ones.

### Prototype token use (its `src`)

`space-*` 3,526 uses (8: 866, 12: 629, 4: 487, 16: 466). `radius-*` 691. `size-*` 754 (control 161, control-lg 125, control-sm 121). Motion: `duration-quick` 446, `ease-smooth-out` 428, `ease-out` 279, `duration-fast` 263. No `--blur-*` use. Every `var()` it reads is defined by its tokens or by the component itself, except `space-40` (one use, to snap in phase 1).

### Real app token use (`apps/`, `packages/` at 34723b989)

Type: label 358, body 307, body-strong 198, label-strong 140, title 91, heading 62, note-title 27, title-regular 15, kbd 13, code 12. Motion: ease-out 138, duration-hover 120, ease-hover 104, duration-move 60, ease-in-out 45, duration-modal 44, duration-press 37, other durations under 25, `public-*` 21 in all. Space 2,567. Colours renamed: accent-line 92, tag borders 68, surface-sunken 38, field-border 10, the rest under 7.

### Colours

Shared names (49) take the prototype's values. Prototype only: canvas, surface-shell, primary, primary-hover, on-primary, accent-text, success-soft, warning, warning-soft, danger-soft. Real only: mapped in index.md, or kept in legacy.json. `focus-ring` changes meaning, from a translucent halo colour to a solid ring colour, so the two focus shadows change value with it.

### Font touchpoints found

`packages/tokens` (tokens.json fonts, packs.ts, fonts folder, generator tests), `packages/ui` (vite.ts preload and test, `.storybook/vitest.fonts.ts`, chart-math estimate, Avatar and ReadyPanel comments, LinkPage defaults), `apps/web` (vite.config preload, build.test, `e2e/fonts.flow.ts`, OG cards in `card-image.ts` and `api/card.mjs` with an Inter TTF), `packages/emails` test on the mono stack, comments in contracts and core, and the marketing site's fonts.css comment. `vercel.json` CSP is `font-src 'self'`.

### Screenshot baselines

`packages/ui/__screenshots__/`, 1,347 stories × light and dark, Chromium only, shot in `mcr.microsoft.com/playwright:v1.63.0-noble` (linux/amd64) by `pnpm test:visual`. CI only compares and uploads new shots as an artifact on failure; a person commits them. No other suite has screenshots.
