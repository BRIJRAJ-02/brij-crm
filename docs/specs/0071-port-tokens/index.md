# 0071. Port phase 0: the Timefix type scale and tokens

**Date**: 2026-11-12
**Status**: In Progress
**Amends**: [0002 Design tokens](../0002-design-tokens/index.md) (the generator, theme logic, Icon atom and lint rules stay; the source file, the values, the names and the fonts change)

## Summary

The Timefix prototype draws the dashboard at 88% with CSS `zoom`. The real app will draw the same thing with real token values and no zoom. The prototype's `tokens.json` becomes the one source, written in its full size units, and the generator writes two sets of sizes from it: full size for public pages, and 88% (rounded to tidy pixels) for the app, switched by one attribute on `<html>`. Token names follow the prototype, so later phases can copy the prototype's CSS without translating it. Geist and Geist Mono replace Inter and JetBrains Mono, and motion moves to the prototype's transitions.dev scale, keeping the two house rules (no press shrink, no blur).

## Rationale

Reasoning, the options compared and the full token inventory: [rationale.md](rationale.md).

## Requirements

**User stories**:
- As the owner, I want the real app to look like the Timefix artifacts at the size I approved (88%), so the port lands the design I signed off and not a guess at it.
- As someone booking a meeting or filling in a form, I want public pages at full size, so they read well on a phone.
- As an engineer porting a prototype component in phases 1 to 9, I want the prototype's token names to work as they are in the real app, so I copy CSS instead of translating thousands of names by hand.
- As anyone using a screen reader or a keyboard, I want nothing about focus, contrast or keyboard use to get worse while the look changes.

**Acceptance criteria**:
- **AC-1**: `design/timefix-design-system/tokens.json` is the one token source. `pnpm tokens:build` copies it byte for byte to `packages/tokens/tokens.json`; `pnpm tokens:check` only verifies, and fails with `TOKENS_SOURCE_DRIFT` when the two differ. `source.json` names the source file, the design system artifact and its published version (`unpublished` until someone publishes).
- **AC-2**: The source carries a `density` family with one token, `density-app`, value `0.88`. The prototype's build reads its `zoom` from that token, so the artifact and the app can never disagree on the scale.
- **AC-3**: `tokens.css` writes the scaled families (type sizes and line heights, `spacing`, `radius` except `radius-full`, `size`) twice inside `@layer tokens`: the source values under `:root`, and the app values under `:root[data-scale='app']`. App values follow the scale rules under *Feature design*, and the generator test pins every value in the scale tables there.
- **AC-4**: Families that do not scale (colour, shadow, `borderWidth`, `breakpoint`, `distance`, `duration`, `easing`, `zIndex`, `opacity`, `scale`, `stroke`, letter spacing) are written once, exactly as the source gives them.
- **AC-5**: `theme-boot.js` (already the first script in `index.html`) sets `data-scale="app"` on `<html>` before first paint, unless the path is on the public list under *Public and app scope*. Book, form, menu, reserve, link and landing pages (their own HTML files), partner embeds, the public screens inside `index.html` and the marketing site draw at full size. A computed style check proves it: `--text-body` is `400 12.5px/18px` on Home and `400 14px/20px` on a booking page and on `/embed/tfp_…`.
- **AC-6**: A screen inside the app that shows a guest view full screen can switch the whole document to full size while it is open, through `usePublicScale(on)` from `@crm/ui` (the hook; the plain functions `holdPublicScale`, `applyScaleForPath` and `scaleForPath` are on `@crm/ui/theme`, which stays free of React). It counts nested users, and the app scale comes back when the last one closes.
- **AC-7**: No stylesheet, story or app file uses CSS `zoom` for the scale, and nothing ports the prototype's zoom fix or its drag unzoom helpers (Stylelint refuses `zoom`). One existing, reviewed exception: `HostedFormPreview`'s inert thumbnail tile, which nothing is placed on or pointed at, keeps its `zoom: 0.5` behind a disable comment.
- **AC-8**: The type styles are the seventeen in the type table. Every old `--text-*` and `--tracking-*` name in `apps/`, `packages/` and `tools/` is renamed by the rename map, and no old name is left (the Stylelint unknown variable rule from 0002 AC-10 proves it).
- **AC-9**: Geist and Geist Mono (variable, Latin) are served from `packages/tokens/fonts/` on the app's own origin, each with a metric matched local fallback. Geist is preloaded on every HTML entry where Inter was. Inter and JetBrains Mono are gone from the code, the fonts folder, the Storybook font wait, the OG card renderer and the tests. The CSP is unchanged.
- **AC-10**: Motion uses the prototype's names: durations `stagger`, `micro`, `quick`, `fast`, `medium`, `slow`, `very-slow` plus the kept `spin` and `pulse`; easings `smooth-out`, `in-out`, `out`, `linear`, `bounce`, `bounce-strong`; the `distance` family; scales `large`, `medium`, `small`, `tiny`, `shrunk`. The old role names (`duration-hover`, `duration-public-*`, `ease-hover`, `ease-drawer` and the rest) are gone from code.
- **AC-11**: The house rules hold. Nothing in the app shrinks on press: `scale-press` and `scale-press-sm` stay in the source at 1 (they move in from the old file, since public pages set their own value on their root, as the owner approved for the booking, link and menu pages on 1 and 5 Nov). No `--blur-*` token exists (the `blur` family is deleted from the source; the prototype never uses it). Blur in motion stays what it is today: never in the app, and only where a public page already uses it by the owner's 1 Nov exception. No new lint rule bans it. _(Corrected during the build, 12 Nov: the first draft deleted `scale-press` and banned transitions on `filter`, which would have broken 25 approved public page motions.)_
- **AC-12**: Colours follow the colour section: shared names take the prototype's values, renamed names are renamed in code, new prototype colours exist, and the colours the prototype lacks live in `legacy.json`. Every pair in `src/contrast.ts`, with the updated surfaces list and the new pairs, meets 0002's minimums in both themes. Where a prototype value misses, only that token's OKLCH lightness moves, by the smallest step, in the source, and every move is listed in this spec's rationale for the owner.
- **AC-13**: `packages/tokens/legacy.json` holds every token the code still needs that the prototype does not have, in the source's grammar (families optional) with a `retire` note per token naming the port phase that removes it. Values are today's shipped values except the ones this spec sets (`danger-hover`, `shadow-focus`, `shadow-focus-inset`). Legacy tokens are never scaled, go through the normal theme and plain blocks, and a name in both files is refused (`TOKENS_DUPLICATE`).
- **AC-14**: Every library screenshot baseline is reshot once in the pinned Playwright image after the change, and `pnpm test:visual` passes against the new set. Public component stories are shot at full size and the rest at app size.
- **AC-15**: `pnpm check`, `pnpm test`, `pnpm size` and `pnpm build` are green, and the emails package draws with the source's full size values plus legacy (body text 14px, the prototype's colours), with no scale logic of its own.
- **AC-16**: TypeScript reads token values only through the generated module `@crm/tokens/values` (source plus legacy, both scales). `@crm/ui`'s readers (`sizeToken`, `spaceToken`, `radiusToken`, `typeToken`, `breakpointToken`, `durationToken` and the rest) return the value for the document's current `data-scale`, read when a component renders, never cached in a module level constant. `DataGrid`'s row height equals the CSS row height in both scales.
- **AC-17**: A porting rule is recorded for phases 1 to 9 (in `packages/tokens/AGENTS.md` through `/sync`): every raw length in prototype CSS becomes a token; if no token fits, the source gains one first. Nothing ports a raw prototype pixel value.

## Decision

**Chosen option**: one source in full size units with a generated app scale (Option 2 in the rationale).

The prototype's `tokens.json` is the source, unchanged in meaning; the generator derives the 88% app values from `density-app` and fixed rounding rules, and one attribute on `<html>` picks the set.

**Implementation skills**:
- `crm-design-system` (`.claude/skills/crm-design-system/`): house rules, always
- `modern-css-html` (`kemiljk/skills`, `.claude/skills/modern-css-html/`): cascade layers, attribute scoped custom properties
- `better-typography` (`jakubkrehel/skills`, `.claude/skills/better-typography/`): the type scale and fallback metrics
- `better-accessibility` (`jakubkrehel/skills`, `.claude/skills/better-accessibility/`): the focus ring and contrast moves
- `transitions-polish` (`.claude/skills/transitions-polish/`): the motion token mapping
- `zod` (`pproenca/dot-skills`, `.claude/skills/zod/`): the grammar changes
- `vitest` (`antfu/skills`, `.claude/skills/vitest/`): generator, contrast and scale tests
- `stories` (`.claude/skills/stories/`): the Storybook scale decorator and the reshoot

## Feature design

### Where things live

| Path | Owns |
|---|---|
| `design/timefix-design-system/tokens.json` | The one source. Edited here, published to the design system artifact from here |
| `packages/tokens/tokens.json` | Byte copy of the source, written by `tokens:build` (exports and Stylelint read it from the package) |
| `packages/tokens/legacy.json` | New. Tokens the code still needs that the source lacks. Hand edited, shrinks each phase |
| `packages/tokens/source.json` | `{ "source": "design/timefix-design-system/tokens.json", "artifact": "https://claude.ai/artifact/KzpzW1c8binDdobPZ2HB11", "version": "<published version id, or unpublished>", "synced": "2026-11-xx" }`. `TokenSource` in `scripts/generate.ts` and the CSS header take the new field |
| `packages/tokens/src/grammar.ts` | `TypeStyle.fontWeight` accepts a string or a number (the source writes numbers), transformed to a string. A legacy file schema: the same families, all optional, each token with a required `retire` string |
| `packages/tokens/scripts/generate.ts` | Adds the copy, the app scale block, the legacy merge, `TOKENS_SOURCE_DRIFT` and the values module |
| `packages/tokens/tokens-app.css` | New, generated and committed (`@crm/tokens/tokens-app.css`): the app scale block alone. `@crm/ui/app.css` (the root stylesheet plus this) is what the app and the stories load; public pages load `@crm/ui/styles.css` and never carry it |
| `packages/tokens/values.ts` | New, generated and committed (`@crm/tokens/values`). For every plain, size and type token: `{ full, app }` numbers in px (or the string for non numeric families), plus `legacy` tokens with one value. Checked by `tokens:check` like `tokens.css` |
| `packages/tokens/scripts/rename-0071.ts` | New, temporary. The rename map as data and a guarded rewrite (see *Rename map*). Deleted once no open branch needs it |
| `packages/tokens/fonts/` | `Geist-Variable-latin.woff2`, `GeistMono-Variable-latin.woff2` added; Inter and JetBrains Mono files removed; `LICENSE.md` updated (both SIL OFL 1.1) |
| `packages/ui/src/lib/token-values.ts` | Reads `@crm/tokens/values` and `document.documentElement.dataset.scale` on each call |
| `packages/ui/src/theme/scale.ts` | New. `usePublicScale(on)` (AC-6) and `currentScale()` |
| `apps/web/public/theme-boot.js` | Also sets `data-scale="app"` unless the path is public (AC-5) |
| `design/timefix-design-system/scripts/standalone.mjs` | Reads `density-app` for its zoom instead of the literal `0.88` |

### The scale rules (AC-3)

`d` is `density-app` (0.88). For a source value `v` in px, computed in integer maths (`v × 88`, then divided and rounded) so floating point can never move a value; an exact tie rounds up.

| What | App value | Why |
|---|---|---|
| Font size | `v × d`, rounded to the nearest 0.5px | Keeps every step of the prototype distinct (whole pixels would merge 12 and 13 into 11) and stays within 0.2px of the artifact |
| Line height | `v × d`, rounded to the nearest even px | Text sits centred on whole pixels inside even height boxes |
| Heights: `size-control-sm`, `size-control`, `size-control-lg`, `size-row`, `size-nav-item`, `size-topbar`, `size-avatar`, `size-avatar-lg` | `v × d`, rounded to the nearest even px | Whole pixel rows keep hairlines sharp and give the virtualised table a whole row height |
| Widths: `size-icon`, `size-icon-lg`, `size-sidebar`, `size-menu`, `size-dialog`, `size-dialog-wide`, `size-panel`, `size-measure`; every `spacing` token; `radius` except `radius-full` | `v × d`, rounded to the nearest whole px | Crisp edges at 1x |
| Not scaled | `borderWidth`, `shadow`, `breakpoint`, `distance`, letter spacing (em), `radius-full`, `stroke`, everything in `legacy.json` | Hairlines must stay 1px; shadows and motion distances differ by less than a pixel; breakpoints are viewport widths, which zoom never changed |

The two lists above live in the generator. A new `size` token in the source that is on neither list is refused with `TOKENS_INVALID`, so a later token cannot silently take the wrong rule. The lists apply to the source only.

**Names do not change with the scale.** `space-16` is the 16 step: it draws 14px in the app and 16px on a public page. The token's `usage` note says so.

**Side effects you accept:** sums stop matching exactly in the app (`space-4` + `space-4` is 8, `space-8` is 7), and the concentric radius rule is off by about a pixel (`radius-lg` 12 against `radius-md` 9 plus `space-4` 4). Neither is visible; components use one token per gap and never add tokens up to match another.

### Scale tables (pinned by the generator test)

Type (source → app; weights from the source):

| Style | Source | App | Letter spacing | Replaces in code |
|---|---|---|---|---|
| `display` | 500 32/40 | 28/36 | -0.02em | (new; public pages) |
| `title-lg` | 500 24/32 | 21/28 | -0.015em | `note-title` |
| `title` | 500 18/26 | 16/22 | -0.01em | `heading` |
| `heading` | 500 15/22 | 13/20 | -0.005em | `title` |
| `heading-strong` | 600 15/22 | 13/20 | -0.005em | (new) |
| `heading-regular` | 400 15/22 | 13/20 | -0.005em | `title-regular` |
| `body-lg` | 400 16/24 | 14/22 | 0 | (new; public pages) |
| `body-lg-strong` | 500 16/24 | 14/22 | 0 | (new) |
| `body` | 400 14/20 | 12.5/18 | 0 | `body` |
| `body-strong` | 500 14/20 | 12.5/18 | 0 | `body-strong` |
| `body-sm` | 400 13/20 | 11.5/18 | 0 | (new) |
| `body-sm-strong` | 500 13/20 | 11.5/18 | 0 | (new) |
| `body-sm-tight` | 400 13/18 | 11.5/16 | 0 | (new) |
| `label` | 500 12/16 | 10.5/14 | 0 | `label`, `label-strong` |
| `caption` | 400 12/16 | 10.5/14 | 0 | (new) |
| `kbd` | 500 11/16 | 9.5/14 | 0.02em | `kbd` |
| `code` | 400 12/18 mono | 10.5/16 | 0 | `code` |

The six styles beyond the prototype's eleven go in the source's Headings group (`heading-strong`, `heading-regular`) or Text group (the rest), each with a sample and a usage note. Five are the font shorthands the prototype's CSS writes as raw values fifteen or more times (counts in the rationale); `heading-regular` exists because `title-regular` needs a home. Rarer raw combinations snap to the nearest style when their component is ported; a phase that cannot snap one without a visible change adds a style to the source first.

Spacing: 2→2, 4→4, 6→5, 8→7, 12→11, 16→14, 20→18, 24→21, 32→28, 48→42, 64→56.
Radius: xs 4→4, sm 6→5, md 10→9, lg 14→12, xl 20→18, full unchanged.
Size: control-sm 28→24, control 36→32, control-lg 44→38, row 44→38, nav-item 34→30, topbar 56→50, avatar 28→24, avatar-lg 44→38, icon 16→14, icon-lg 20→18, sidebar 256→225, menu 240→211, dialog 480→422, dialog-wide 720→634, panel 440→387, measure 640→563.

### Generated CSS shape (the change to 0002's)

Source and legacy are merged as data before anything is written: a legacy colour or shadow goes into the theme blocks with the source's, a legacy plain token into the `:root` block, in file order after the source's. Only source tokens of the scaled families get a second value.

```css
@layer tokens {
  :root,
  [data-theme='light'] {
    --canvas: #f2f2f3;                      /* source colours, then legacy colours */
    --tag-red-border: #f5ccd7;
  }
  /* the dark and System blocks, the same way */
  :root {
    --density-app: 0.88;
    --space-16: 16px;                       /* source values, every family, then legacy plain tokens */
    --text-body: 400 14px/20px var(--font-sans);
    --size-chip: 20px;
  }
  :root[data-scale='app'] {
    --space-16: 14px;                       /* scaled source families only */
    --text-body: 400 12.5px/18px var(--font-sans);
  }
}
```

### Rename map (run by `rename-0071.ts`)

| Family | Old → new |
|---|---|
| Type (`--text-*`, `--tracking-*`, `typeToken`) | `heading`→`title`, `title`→`heading`, `title-regular`→`heading-regular`, `note-title`→`title-lg`, `label-strong`→`label` |
| Size | `size-bar`→`size-topbar`, `size-input`→`size-control`, `size-control`→`size-control-sm`, `size-measure`→`size-measure-sm` (legacy, 280px) |
| Colour | `surface-sidebar`→`canvas`, `surface-sunken`→`surface-subtle`, `surface-thumb`→`surface-raised`, `surface-column`→`surface-subtle`, `field-border`→`border-subtle`, `accent-line`→`accent-text`, `danger-fill`→`danger`, `danger-fill-hover`→`danger-hover` (legacy) |
| Duration | `hover`, `press`, `exit` → `duration-quick`; `popover`, `move`, `modal` → `duration-fast`. The eight `duration-public-*` keep their names as legacy tokens (see below) |
| Easing | `ease-out`→`ease-smooth-out`, `ease-hover`→`ease-out`, `ease-drawer`→`ease-smooth-out`; `ease-in-out` keeps its name (its value becomes the keyword) |
| Scale | `scale-enter`→`scale-medium`; `scale-press` and `scale-press-sm` keep their names (1 in the app; public pages set their own) |

How the script works:
- **One pass through placeholders.** Every match becomes a placeholder first, then every placeholder its new name, so swaps (`heading` and `title`, `size-control` and `size-input`, `ease-out` and `ease-hover`) never chain.
- **Guarded, so it cannot undo itself.** Before writing, it scans the target and refuses (exit 1, listing the files) if any new only name is already there: `--text-title-lg`, `--text-heading-regular`, `--size-control-sm`, `--size-topbar`, `--ease-smooth-out`, `--duration-quick`, `--canvas`. Run it on an open branch before rebasing onto the landed phase 0, never after.
- **What it matches**, and nothing else: `var(--old` in any position; `'--old'` and `"--old"` strings (`getPropertyValue`, `setProperty`, stories); local `--old:` declarations; and the first string argument of the token readers (`sizeToken('old')`, `typeToken('heading')` and the rest). A bare `'heading'`, `'title'` or `'label'` anywhere else is never touched (they are also role names and variants).
- **Files**: `.css`, `.ts`, `.tsx`, `.mjs`, `.md` (component READMEs, AGENTS files) under `apps/`, `packages/` and `tools/`, never `docs/specs/` or `design/`.

### legacy.json at the start (AC-13)

At today's shipped values (`packages/tokens/tokens.json` at 34723b989), unscaled, unless set below:
- **Sizes:** `size-toolbar`, `size-table-header`, `size-chip`, `size-check`, `size-switch`, `size-icon-sm`, `size-icon-xs`, `size-tile`, `size-kbd`, `size-measure-sm` (today's `size-measure`), `size-dialog-sm`, `size-dialog-form`, `size-palette`, `size-panel-wide`, `size-page-card`, `size-board-column`, `size-sidebar-collapsed`, every `size-column*`. Retire: phase 1 (atoms and molecules) or phase 4 (shell, columns).
- **Colours:** the nine `tag-*-border` (phase 1: the prototype's tags have no outline), `inverse-hover`, `border-inverse`, `scrim-soft`, `on-accent-kbd`, `danger-hover` (all phase 1).
- **`danger-hover`** (new value): `danger` with OKLCH lightness 0.06 lower in light and 0.06 higher in dark, so hover reads as a change in both themes and `on-danger` on it still meets 4.5:1 (the contrast suite checks it).
- **Shadows:** `shadow-control`, `shadow-primary`, `shadow-pinned-edge` (phase 1) at shipped values. `shadow-focus` and `shadow-focus-inset` get new values, because `focus-ring` turns solid and a single 2px ring in the accent's own blue would vanish on blue buttons. Both become a two ring shadow that looks like the prototype's offset outline: `0 0 0 2px <surface>, 0 0 0 4px <focus-ring>` (light `#ffffff` then `#2457e6`, dark `#18181b` then `#8fb0ff`), and the inset one `inset 0 0 0 2px <focus-ring>, inset 0 0 0 4px <surface>`. Literal colours, as the shadow grammar requires. Retire in phase 1, when components move to the prototype's `outline` ring.
- **Durations:** the eight `duration-public-*` at their shipped values. The public booking page and its receipt keep the calmer pace the owner asked for on 2 Nov ("a bit slower, too fast, smoother") by pointing `--duration-quick` at `duration-public-hover` and `--duration-fast` at `duration-public-move` on their root. Retire: phase 6, which restates that pace in the prototype scale. _(Changed during the build, 12 Nov: the first draft folded them into the scale, which would have sped those pages up.)_
- **Not legacy, moved into the source** (system wide, so the artifact shows them): `z-raised`, `opacity-pulse`, `border-width-thick`, `duration-spin`, `duration-pulse`, `scale-press`, `scale-press-sm`, `scale-shrunk`, `icon-stroke` and the `breakpoint` family.

### Colours (AC-12)

- Shared names (49) take the prototype's values. New from the prototype: `canvas`, `surface-shell`, `primary`, `primary-hover`, `on-primary`, `accent-text`, `success-soft`, `warning`, `warning-soft`, `danger-soft`.
- `src/contrast.ts`: the surfaces list drops `surface-sidebar` and `surface-column` and adds `canvas` and `surface-shell`. New pairs: `on-primary` on `primary` and `primary-hover` (4.5); `focus-ring` against `canvas` and every surface (3); `accent-text` on `accent-soft` and on every surface (4.5); `success`, `warning` and `danger` on their `-soft` and on every surface (4.5); `on-danger` on `danger-hover` (4.5); `border-inverse` on `surface-inverse` (3). The checker reads `legacy.json` too.
- The cross check measured about 26 misses with the prototype's values (for example `control-border` 3.42 on `surface` in light, `text-tertiary` 4.35 on `surface-selected`). The minimums stay as 0002 set them. Each miss moves only that token's OKLCH lightness in the source, by the smallest step that clears every pair it is in. The builder lists every move (token, theme, before, after) in rationale.md before landing, and the owner approves the list with the screenshot review.

### Fonts (AC-9)

- **Files:** Geist and Geist Mono variable Latin woff2 from Fontsource (`@fontsource-variable/geist`, `@fontsource-variable/geist-mono`), the same route the link page packs used, versions pinned in the commit message. Not from Google Fonts: the CSP allows `font-src 'self'` only.
- **Source entries:** `type.fonts` gains `{ "family": "Geist", "file": "fonts/Geist-Variable-latin.woff2", "weight": "100 900", "style": "normal" }` and the same for Geist Mono (`GeistMono-Variable-latin.woff2`, `100 900`). The generator already refuses a named file that is missing.
- **Fallbacks:** a metric matched local face for each (`size-adjust`, `ascent-override`, `descent-override`, `line-gap-override`), derived from the woff2's own metrics over Arial for Geist and Courier New for Geist Mono, the same method and file layout `packs.css` used for its six. The family stacks list the fallback right after the face.
- **Preload:** `FIRST_SCREEN_FONTS` in `packages/ui/src/vite.ts` matches `Geist-Variable-latin`; the app and marketing builds inherit it. The build test and `e2e/fonts.flow.ts` move to Geist.
- **Size:** record both files' sizes in the commit message against Inter's 73 KB. `pnpm size` does not count fonts, so this is the check.
- **Link page packs:** "Modern" and "Mono" (`packages/tokens/src/packs.ts`, contracts `PAGE_FONTS` comments) become Geist and Geist Mono. Published link pages, booking pages and forms that use them change face, as the owner decided on 10 Nov.
- **OG cards** (`apps/web/card-image.ts`, `api/card.mjs`, `card-image.test.ts`): satori cannot read woff2, so `api/card-assets/` swaps the Inter TTF for Geist 400 and 500 static Latin WOFF files from `@fontsource/geist`, with the licence.
- **Storybook:** `packages/ui/.storybook/vitest.fonts.ts` waits for `16px Geist` and `16px "Geist Mono"`.
- **Charts:** `chart-math.ts` keeps its 0.62em label estimate unless a check against Geist's widest digits shows labels clipping.

### Public and app scope (AC-5, AC-6)

- `:root` without `data-scale` is full size. That is the safe default: anything that misses the attribute draws like the artifact's public pages, never smaller.
- `theme-boot.js` sets `data-scale="app"` on `<html>` before first paint, except when the path starts with one of: `/embed/` (partner embeds), `/email-preferences`, `/status`, `/public/` (public insights), or any other path the router serves outside the signed in shell as a public screen. The builder lists the exact set from the router and `vercel.json` rewrites, and a unit test holds the list. Sign in, sign up, join, invite, verify and two factor stay at app scale, as the prototype draws them.
- Book, form, menu, reserve, link and landing pages are their own HTML files and never load the scale. Embedded forms stay full size even when `main.ts` drops `data-public-page` inside a frame.
- Editor previews (`PreviewLayout`) frame the real public pages in an iframe, so they draw at full size. That is right: the preview is the page the guest will see.
- Container queries keep their breakpoint values. In the app a container is about 12% narrower than under zoom, so a container condition switches at a slightly different layout. Phase 0 accepts this; each phase retunes the conditions of the components it ports (CSS cannot vary a container query length by a custom property).
- Storybook: a global decorator sets `data-scale="app"` and puts the attribute back as it was when the story ends (stories share one page across files). Stories under `public-booking`, `public-form`, `public-menu`, `LinkPage` and the venue pages set the parameter `scale: 'public'`.

### Value sourcing

| Action | Value | Source |
|---|---|---|
| Generate app values | each scaled value | source value × `density-app`, by the scale rules |
| Generate full values | each value | the source, as written |
| Generate legacy values | each legacy token | `legacy.json` (today's shipped values, or the values set in this spec) |
| Pick the scale | which block applies | `data-scale` on `<html>`: `theme-boot.js` and its public path list, or `usePublicScale` |
| A size read in TypeScript | px number | `@crm/tokens/values`, `full` or `app` by `currentScale()` at render time |
| Email drawing | sizes, colours, type | source full values plus legacy, as data |
| Contrast moves | new lightness | the smallest OKLCH step that clears every pair; listed for the owner |
| Font files | woff2, WOFF | Fontsource packages (pinned), SIL OFL licence |
| Fallback metrics | four overrides per face | measured from the woff2, the `packs.css` method |
| Published artifact version | `source.json` `version` | the publish result; `unpublished` until someone with access publishes |

### Key invariants

- One source: the copy and the source never differ (`TOKENS_SOURCE_DRIFT`).
- No name in both `tokens.json` and `legacy.json`.
- Every source `size` token is on the height list or the width list.
- No `zoom`, no press scale in the app, no blur family.
- Hairlines stay 1px at every scale.
- No TypeScript caches a token value at module level.

### Security model

No data, no permissions. The CSP stays `font-src 'self'`; nothing loads from a font CDN.

### Critical test scenarios

- Generator: the scale tables above, value for value, from the real source → AC-3, AC-4
- Source drift: change one byte of the copy → `TOKENS_SOURCE_DRIFT`, exit 1 → AC-1
- Grammar: a numeric `fontWeight` parses; a `blur` family in a fixture is refused by a new house rule test → AC-11
- Legacy clash: put `size-row` in `legacy.json` → `TOKENS_DUPLICATE` → AC-13
- Unclassed size: add `size-new` to a source fixture → `TOKENS_INVALID` → AC-3
- Computed style on Home, on a booking page and on `/embed/tfp_…`, light and dark → AC-5
- `usePublicScale` nested twice, closed in reverse order → app scale back only after the last; `sizeToken('size-row')` follows it → AC-6, AC-16
- `DataGrid` row element height equals `sizeToken('size-row')` in both scales → AC-16
- Contrast suite in both themes with the new pairs and legacy colours → AC-12
- Rename script on a fixture with both old and new names → refuses; on old names only → one pass gives the mapped names, and a bare `'title'` string is untouched → AC-8
- Stylelint refuses `zoom: 0.9`, `var(--text-note-title)`, `var(--duration-hover)` → AC-7, AC-8, AC-10
- Build test: Geist preloaded, Inter absent from `dist` → AC-9
- Focus ring visible on a primary blue button and on `surface` in both themes (story shot) → AC-12

## Build plan

Tracer Bullet: the thinnest end to end thread is "source → generator → one app screen and one public page at the right scale". Then thicken.

1. Grammar and generator: numeric font weight, the legacy schema, the copy step, the app scale block with integer rounding and the height and width lists, the data level legacy merge, `TOKENS_SOURCE_DRIFT`, and the generated `values.ts`. Tests against fixtures first. Satisfies **AC-1**, **AC-3**, **AC-4**, **AC-13**, **AC-16**
2. Source edits in `design/timefix-design-system/tokens.json`: `density-app`; the six added type styles; the system families moved in; Geist font entries; delete the `blur` family and rewrite the `scale` note (it says presses use `scale-medium`, which the house rule forbids). `standalone.mjs` reads the density. Rebuild the prototype once and check its smoke walk still passes. Satisfies **AC-2**, **AC-11**
3. `tokens:build`: copy, `legacy.json`, `source.json`, `tokens.css`, `values.ts`. Satisfies **AC-1**, **AC-13**
4. Scope: `theme-boot.js` with the public path list and its test, `usePublicScale` and `currentScale`, the Storybook decorator. Tracer check: Home, a booking page and a partner embed show the right computed values. Satisfies **AC-5**, **AC-6**
5. `token-values.ts` reads `@crm/tokens/values` per call; move every module level token constant (`DataGrid`, TaskList, ActivityFeed, Menu, AsideLayout, RecordLayout, NoteList, KanbanColumn, WeekCalendar, TeamDay and any other the search finds) into render. Emails read full plus legacy. Satisfies **AC-15**, **AC-16**
6. Run `rename-0071.ts`; fix whatever lookups the tests still flag. Satisfies **AC-8**, **AC-10**, **AC-11**, **AC-12**
7. Fonts: files, fallbacks, preload, packs, OG cards, Storybook wait, tests, size note. Satisfies **AC-9**
8. Lint: Stylelint refuses `zoom`; 0002's renamed name fixtures updated (`duration-fast` is a real token again). Satisfies **AC-7**
9. Contrast: the new surfaces list and pairs, legacy colours read, `danger-hover` and the focus shadows set; run the suite, make the smallest lightness moves in the source, list them in rationale.md. Satisfies **AC-12**, **AC-13**
10. Reshoot the 2,694 baselines in the pinned image, diff the folder, review a before and after sheet of a sample from every component folder in both themes together with the contrast move list, then commit. Satisfies **AC-14**
11. Full check, tests, size, build; `/check verify` against `verify.md`; `/sync` writes the porting rule. Satisfies **AC-15**, **AC-17**

## Migration plan

**Strategy**: one branch, one landing (the token names are global, so a partial landing would leave mixed names).
**Phases**: build on `feat/port-0`; land on `main` once CI is green, the screenshot review is done and the owner has approved the contrast moves. Phases 1 to 9 branch from that.
**Rollback**: revert the one merge commit; the tokens, fonts and names come back together.
**Risks**: open branches using old names conflict (they run `rename-0071.ts` before rebasing; the guard stops a run after); the app looks in between until phase 1 restyles components (new sizes on old component CSS, a 36px legacy table header beside 38px rows).

## Consequences

**Positive**:
- The port copies prototype CSS as it is: same names, same units, right size.
- One number (`density-app`) moves both the artifact and the app.
- No zoom, so no React Aria placement patch and no drag maths.

**Negative / tradeoffs**:
- A token name is a step, not a pixel count in the app (`space-16` is 14px there). The usage note says so, and reviewers must remember it.
- App text gets smaller than today (body 13px → 12.5px, labels 11px → 10.5px, keycaps 9.5px). That is the size the owner approved, but it is small for long reading; browser zoom still works.
- Until phase 1, live screens show new sizes, Geist and new colours on old component designs.
- Some prototype colours move slightly to meet contrast, so the app and the artifact differ there until the artifact is republished.
- Container queries switch at slightly different layouts until each phase retunes them.
- The public booking page keeps its calmer pace through legacy `duration-public-*` tokens until phase 6; other public pages move to the prototype scale. Published pages using "Modern" change from Inter to Geist.
- Every open branch that touches CSS needs the rename script before rebasing; `feat/marketing-redesign` is one.
- `legacy.json` is a second hand edited file until it empties.
- Every page's tokens grew (the prototype's colours and styles, the legacy set, the Geist fallback faces): the hosted form's CSS budget goes from 18 kB to 18.8 kB and the booking page's from 18.7 kB to 19.5 kB (measured 18.57 and 19.37 kB gzipped). The app's own sizes are kept out of public pages in `tokens-app.css`, which only the app and the stories load.

**Neutral**:
- 2,694 baselines change in one commit.
- 0002's rule "a value is decided in the artifact" still holds; the artifact is now published from the repo folder rather than the other way round.

## Follow-up

- [ ] Publish the design system artifact from `design/timefix-design-system` after step 2, from the account that owns it (this session's account cannot open it), and set `source.json` `version`.
- [ ] `/sync`: AGENTS.md (fonts line, the token source), `packages/tokens/AGENTS.md` (the porting rule, AC-17), the `crm-design-system` skill (scale rule, new names, `scale-press` gone).
- [ ] Start `docs/scope/port-ledger.md` from `parity-gaps.md` (handover) before phase 1.
- [ ] Each phase deletes the `legacy.json` entries it retires and retunes the container queries of what it ports.
