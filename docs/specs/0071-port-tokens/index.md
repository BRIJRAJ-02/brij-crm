# 0071. Port phase 0: the Timefix type scale and tokens

**Date**: 2026-11-12
**Status**: Proposed
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
- **AC-1**: `design/timefix-design-system/tokens.json` is the one token source. `packages/tokens/tokens.json` is a byte for byte copy of it, and `pnpm tokens:check` fails with `TOKENS_SOURCE_DRIFT` when the two differ. `source.json` names the source file, the design system artifact and its published version.
- **AC-2**: The source carries a `density` family with one token, `density-app`, value `0.88`. The prototype's build reads its `zoom` from that token, so the artifact and the app can never disagree on the scale.
- **AC-3**: `tokens.css` writes the scaled families (type sizes and line heights, `spacing`, `radius` except `radius-full`, `size`) twice inside `@layer tokens`: the source values under `:root`, and the app values under `:root[data-scale='app']`. App values follow the rounding rules under *Feature design*, and the generator test pins every value in the scale tables there.
- **AC-4**: Families that do not scale (colour, shadow, `borderWidth`, `breakpoint`, `distance`, `duration`, `easing`, `zIndex`, `opacity`, `scale`, `stroke`, letter spacing) are written once, exactly as the source gives them.
- **AC-5**: The app's `index.html` carries `data-scale="app"` on `<html>` from the first byte. Every public entry (book, form, menu, reserve, link and landing pages, every embed) and the marketing site carry no `data-scale`, so they draw at full size. A computed style check proves it: `--text-body` is `400 12.5px/18px` in the app and `400 14px/20px` on a booking page.
- **AC-6**: A screen inside the app that shows a guest view full screen can switch the whole document to full size while it is open, through `usePublicScale(on)` from `@crm/ui/theme`. It counts nested users, and the app scale comes back when the last one closes.
- **AC-7**: No stylesheet, story or app file uses CSS `zoom`, and nothing ports the prototype's zoom fix or its drag unzoom helpers (Stylelint refuses `zoom`).
- **AC-8**: The type styles are the seventeen in the type table. Every old `--text-*` and `--tracking-*` name in `apps/`, `packages/` and `tools/` is renamed by the rename map, and no old name is left (the Stylelint unknown variable rule from 0002 AC-10 proves it).
- **AC-9**: Geist and Geist Mono (variable, Latin) are served from `packages/tokens/fonts/` on the app's own origin, each with a metric matched local fallback. Geist is preloaded on every HTML entry where Inter was. Inter and JetBrains Mono are gone from the code, the fonts folder, the Storybook font wait, the OG card renderer and the tests. The CSP is unchanged.
- **AC-10**: Motion uses the prototype's names: durations `stagger`, `micro`, `quick`, `fast`, `medium`, `slow`, `very-slow` plus the kept `spin` and `pulse`; easings `smooth-out`, `in-out`, `out`, `linear`, `bounce`, `bounce-strong`; the `distance` family; scales `large`, `medium`, `small`, `tiny`, `shrunk`. The old role names (`duration-hover`, `duration-public-*`, `ease-hover`, `ease-drawer` and the rest) are gone from code.
- **AC-11**: The house rules hold. No `--scale-press` or `--scale-press-sm` token exists, nothing shrinks on press, no `blur` family is ported, and no `transition` or `animation` touches `filter` or `backdrop-filter`.
- **AC-12**: Colours follow the colour table: shared names take the prototype's values, renamed names are renamed in code, new prototype colours exist, and the colours the prototype lacks live in `legacy.json`. Every pair in `src/contrast.ts` (including the new `canvas`, `surface-shell` and `primary` pairs) meets 0002's minimums in both themes.
- **AC-13**: `packages/tokens/legacy.json` holds every token the code still needs that the prototype does not have, at its current shipped value, unscaled, each with a `retire` note naming the port phase that removes it. The generator merges it after `tokens.json` and refuses a name that is in both (`TOKENS_DUPLICATE`).
- **AC-14**: Every library screenshot baseline is reshot once in the pinned Playwright image after the change, and `pnpm test:visual` passes against the new set. Public component stories are shot at full size and the rest at app size.
- **AC-15**: `pnpm check`, `pnpm test`, `pnpm size` and `pnpm build` are green, and the emails package draws with the source's full size values (body text 14px, the prototype's colours), with no scale logic of its own.

## Decision

**Chosen option**: one source in full size units with a generated app scale (Option 2 in the rationale).

The prototype's `tokens.json` is the source, unchanged in meaning; the generator derives the 88% app values from `density-app` and fixed rounding rules, and one attribute on `<html>` picks the set.

**Implementation skills**:
- `crm-design-system` (`.claude/skills/crm-design-system/`): house rules, always
- `modern-css-html` (`kemiljk/skills`, `.claude/skills/modern-css-html/`): cascade layers, attribute scoped custom properties
- `better-typography` (`jakubkrehel/skills`, `.claude/skills/better-typography/`): the type scale and fallback metrics
- `transitions-polish` (`.claude/skills/transitions-polish/`): the motion token mapping
- `zod` (`pproenca/dot-skills`, `.claude/skills/zod/`): the grammar changes
- `vitest` (`antfu/skills`, `.claude/skills/vitest/`): generator, contrast and scale tests
- `stories` (`.claude/skills/stories/`): the Storybook scale decorator and the reshoot

## Feature design

### Where things live

| Path | Owns |
|---|---|
| `design/timefix-design-system/tokens.json` | The one source. Edited here, published to the design system artifact from here |
| `packages/tokens/tokens.json` | Byte copy of the source (exports and Stylelint read it from the package) |
| `packages/tokens/legacy.json` | New. Tokens the code still needs that the source lacks, same grammar, plus a `retire` field per token. Hand edited, shrinks each phase |
| `packages/tokens/source.json` | `{ "source": "design/timefix-design-system/tokens.json", "artifact": "https://claude.ai/artifact/KzpzW1c8binDdobPZ2HB11", "version": "<published version id, or unpublished>", "synced": "2026-11-xx" }` |
| `packages/tokens/scripts/generate.ts` | Adds the app scale block, the legacy merge and the source drift check |
| `packages/tokens/scripts/rename-0071.ts` | New, temporary. The rename map as data and a rewrite over `apps/`, `packages/`, `tools/`. Rerunnable on any open branch. Deleted once no branch needs it |
| `packages/tokens/fonts/` | `Geist-Variable-latin.woff2`, `GeistMono-Variable-latin.woff2` added; Inter and JetBrains Mono files removed; `LICENSE.md` updated (both SIL OFL 1.1) |
| `packages/ui/src/theme/scale.ts` | New. `usePublicScale(on)` (AC-6) |
| `apps/web/index.html` | `<html data-scale="app">` |
| `design/timefix-design-system/scripts/standalone.mjs` | Reads `density-app` for its zoom instead of the literal `0.88` |

### The scale rules (AC-3)

`d` is `density-app` (0.88). For a source value `v` in px:

| What | App value | Why |
|---|---|---|
| Font size | `v × d`, rounded to the nearest 0.5px | Keeps every step of the prototype distinct (whole pixels would merge 12 and 13 into 11) and stays within 0.2px of the artifact |
| Line height | `v × d`, rounded to the nearest even px | Text sits centred on whole pixels inside even height boxes |
| Heights of controls, rows, bars, avatars (`size-control*`, `size-row`, `size-nav-item`, `size-topbar`, `size-avatar*`) | `v × d`, rounded to the nearest even px | Whole pixel rows keep hairlines sharp and give the virtualised table a whole row height |
| Every other scaled length (`spacing`, `radius`, other `size`) | `v × d`, rounded to the nearest whole px | Crisp edges at 1x |
| Not scaled | `borderWidth`, `shadow`, `breakpoint`, `distance`, letter spacing (em), `radius-full`, `stroke` | Hairlines must stay 1px; shadows and motion distances differ by less than a pixel; breakpoints are viewport widths, which zoom never changed |

The generator keeps a list of which `size` tokens are heights (the row above); a new `size` token in the source must be added to that list or to the width list, or the generator refuses it with `TOKENS_INVALID`. That stops a later token from silently taking the wrong rule.

**Names do not change with the scale.** `space-16` is the 16 step: it draws 14px in the app and 16px on a public page. The token's `usage` note says so.

### Scale tables (pinned by the generator test)

Type (source → app; weights from the source; letter spacing unchanged):

| Style | Source | App | Replaces in code |
|---|---|---|---|
| `display` | 500 32/40 | 28/36 | (new; public pages) |
| `title-lg` | 500 24/32 | 21/28 | `note-title` |
| `title` | 500 18/26 | 16/22 | `heading` |
| `heading` | 500 15/22 | 13/20 | `title` |
| `heading-strong` | 600 15/22 | 13/20 | (new) |
| `heading-regular` | 400 15/22 | 13/20 | `title-regular` |
| `body-lg` | 400 16/24 | 14/22 | (new; public pages) |
| `body-lg-strong` | 500 16/24 | 14/22 | (new) |
| `body` | 400 14/20 | 12.5/18 | `body` |
| `body-strong` | 500 14/20 | 12.5/18 | `body-strong` |
| `body-sm` | 400 13/20 | 11.5/18 | (new) |
| `body-sm-strong` | 500 13/20 | 11.5/18 | (new) |
| `body-sm-tight` | 400 13/18 | 11.5/16 | (new) |
| `label` | 500 12/16 | 10.5/14 | `label`, `label-strong` |
| `caption` | 400 12/16 | 10.5/14 | (new) |
| `kbd` | 500 11/16 | 9.5/14 | `kbd` |
| `code` | 400 12/18 mono | 10.5/16 | `code` |

The six styles marked new beyond the prototype's eleven are the font shorthands its CSS writes as raw values fifteen or more times (counts in the rationale). Rarer raw combinations snap to the nearest style when their component is ported; a phase that cannot snap one without a visible change adds a style to the source first.

Spacing: 2→2, 4→4, 6→5, 8→7, 12→11, 16→14, 20→18, 24→21, 32→28, 48→42, 64→56.
Radius: xs 4→4, sm 6→5, md 10→9, lg 14→12, xl 20→18, full unchanged.
Size: control-sm 28→24, control 36→32, control-lg 44→38, row 44→38, nav-item 34→30, topbar 56→50, avatar 28→24, avatar-lg 44→38, icon 16→14, icon-lg 20→18, sidebar 256→225, menu 240→211, dialog 480→422, dialog-wide 720→634, panel 440→387, measure 640→563.

### Generated CSS shape (the change to 0002's)

```css
@layer tokens {
  /* the theme blocks, unchanged */
  :root {
    --density-app: 0.88;
    --space-16: 16px;                       /* source values, every family */
    --text-body: 400 14px/20px var(--font-sans);
  }
  :root[data-scale='app'] {
    --space-16: 14px;                       /* scaled families only */
    --text-body: 400 12.5px/18px var(--font-sans);
  }
  :root {
    --size-chip: 20px;                      /* legacy.json, unscaled, last */
  }
}
```

### Rename map (run by `rename-0071.ts`, applied to `var(--old)` and to token name strings)

Several renames swap names (`heading` and `title`, `size-control` and `size-input`), so the script rewrites through placeholders in one pass and never runs a chain.

| Family | Old → new |
|---|---|
| Type (`--text-*`, `--tracking-*`) | `heading`→`title`, `title`→`heading`, `title-regular`→`heading-regular`, `note-title`→`title-lg`, `label-strong`→`label` |
| Size | `size-bar`→`size-topbar`, `size-input`→`size-control`, `size-control`→`size-control-sm`, `size-measure`→`size-measure-sm` (legacy, 280px) |
| Colour | `surface-sidebar`→`canvas`, `surface-sunken`→`surface-subtle`, `surface-thumb`→`surface-raised`, `surface-column`→`surface-subtle`, `field-border`→`border-subtle`, `accent-line`→`accent-text`, `danger-fill`→`danger`, `danger-fill-hover`→`danger-hover` (legacy) |
| Duration | `hover`, `press`, `exit`, `public-hover`, `public-press`, `public-exit` → `duration-quick`; `popover`, `move`, `modal`, `public-popover`, `public-move`, `public-modal`, `public-slide` → `duration-fast`; `public-reveal`→`duration-slow` |
| Easing | `ease-out`→`ease-smooth-out` first, then `ease-hover`→`ease-out`; `ease-drawer`→`ease-smooth-out`; `ease-in-out` keeps its name (its value becomes the keyword) |
| Scale | `scale-enter`→`scale-medium`; `scale-press` and `scale-press-sm`: the ten uses are deleted by hand, not renamed |

### legacy.json at the start (AC-13)

All at today's shipped values, unscaled:
- Sizes: `size-toolbar`, `size-table-header`, `size-chip`, `size-check`, `size-switch`, `size-icon-sm`, `size-icon-xs`, `size-tile`, `size-kbd`, `size-measure-sm`, `size-dialog-sm`, `size-dialog-form`, `size-palette`, `size-panel-wide`, `size-page-card`, `size-board-column`, `size-sidebar-collapsed`, every `size-column*`. Retire: phase 1 (atoms and molecules) or phase 4 (shell, columns).
- Colours: the nine `tag-*-border` (phase 1, the prototype's tags have no outline), `inverse-hover`, `border-inverse`, `scrim-soft`, `on-accent-kbd`, `danger-hover` (phase 1).
- Shadows: `shadow-control`, `shadow-primary`, `shadow-pinned-edge` (phase 1). `shadow-focus` and `shadow-focus-inset` change value to the prototype's solid ring, `0 0 0 2px` and `inset 0 0 0 2px` in `focus-ring` (light `#2457e6`, dark `#8fb0ff`), because `focus-ring` itself turns solid; they retire in phase 1 when components move to the prototype's `outline` ring.
- Others: `z-raised`, `opacity-pulse`, `border-width-thick`, `duration-spin`, `duration-pulse`, `icon-stroke` and the `breakpoint` family move into the source instead (they are system wide, not legacy), so the artifact shows them too.

### Fonts (AC-9)

- Files: Geist and Geist Mono variable Latin woff2 from Fontsource (`@fontsource-variable/geist`, `@fontsource-variable/geist-mono`, versions pinned in the commit message), the same route the link page packs used. Not from Google Fonts: the CSP allows `font-src 'self'` only.
- The source's `type.fonts` gains both entries, so the generator writes their `@font-face` (it already refuses a named file that is missing).
- Each face gets a metric matched fallback face (`size-adjust`, `ascent-override`, `descent-override`, `line-gap-override` over a local system font), written the way `packs.css` writes its six.
- `FIRST_SCREEN_FONTS` in `packages/ui/src/vite.ts` matches `Geist-Variable-latin`; the app and marketing builds inherit it.
- The link page pack "Modern" and "Mono" (`packages/tokens/src/packs.ts`, contracts `PAGE_FONTS` comments) become Geist and Geist Mono. Published link pages, booking pages and forms that use them change face, as the owner decided on 10 Nov.
- OG cards (`apps/web/card-image.ts`, `api/card.mjs`): satori cannot read woff2, so `api/card-assets/` swaps the Inter TTF for Geist 400 and 500 static files (TTF or WOFF) with the licence.
- `packages/ui/.storybook/vitest.fonts.ts` waits for `16px Geist` and `16px "Geist Mono"`.
- `chart-math.ts` keeps its 0.62em label estimate unless a check against Geist's widest digits shows labels clipping.

### Public and app scope (AC-5, AC-6)

- `:root` without `data-scale` is full size. That is the safe default: anything that forgets the attribute draws like the artifact's public pages, never smaller.
- Only `apps/web/index.html` sets `data-scale="app"`, statically, so no flash and no script. The public entries are other HTML files and never set it. An embedded form keeps full size even though `main.ts` drops `data-public-page` inside a frame.
- In app previews of public pages (editor previews) inherit the app scale, as they do in the prototype.
- Storybook: a global decorator sets `data-scale="app"`; stories under `public-booking`, `public-form`, `public-menu`, `LinkPage` and the venue pages set the parameter `scale: 'public'`.

### Value sourcing

| Action | Value | Source |
|---|---|---|
| Generate app values | each scaled value | source value × `density-app`, rounded by the scale rules |
| Generate full values | each value | the source, as written |
| Pick the scale | which block applies | `data-scale` on `<html>`: static in `index.html`, or `usePublicScale` |
| Email drawing | sizes, colours, type | `tokens.json` source values (full size), as today |
| Legacy values | each legacy token | today's shipped `packages/tokens/tokens.json` at `origin/main` 34723b989 |
| Font files | woff2, TTF/WOFF | Fontsource packages (pinned), Geist release licence |
| Published artifact version | `source.json` `version` | the publish result; `unpublished` until someone with access publishes |

### Key invariants

- One source: the copy and the source never differ (`TOKENS_SOURCE_DRIFT`).
- No name in both `tokens.json` and `legacy.json`.
- Every `size` token is classed as a height or a width.
- No `zoom`, no press scale, no blur transition.
- Hairlines stay 1px at every scale.

### Security model

No data, no permissions. The CSP stays `font-src 'self'`; nothing loads from a font CDN.

### Critical test scenarios

- Generator: the scale tables above, value for value, from the real source → AC-3, AC-4
- Source drift: change one byte of the copy → `TOKENS_SOURCE_DRIFT`, exit 1 → AC-1
- Legacy clash: put `size-row` in `legacy.json` → `TOKENS_DUPLICATE` → AC-13
- Unclassed size: add `size-new` to a source fixture → `TOKENS_INVALID` → AC-3
- Computed style in the built app and on a built booking page, light and dark → AC-5
- `usePublicScale` nested twice, closed in reverse order → app scale back only after the last → AC-6
- Contrast suite in both themes with the new values → AC-12
- Stylelint refuses `zoom: 0.9`, `var(--text-note-title)`, `var(--duration-hover)`, `transition: filter 150ms` → AC-7, AC-8, AC-10, AC-11
- Build test: Geist preloaded, Inter absent from `dist` → AC-9

## Build plan

Tracer Bullet: the thinnest end to end thread is "source → generator → one app screen and one public page at the right scale". Then thicken.

1. Grammar and generator: the `density` family, the app scale block with the rounding rules, the height and width lists, `legacy.json` merge, `TOKENS_SOURCE_DRIFT`. Tests against fixtures first. Satisfies **AC-1**, **AC-3**, **AC-4**, **AC-13**
2. Source edits in `design/timefix-design-system/tokens.json`: `density-app`, the six added type styles, the system families moved in (`breakpoint`, `stroke`, `z-raised`, `opacity-pulse`, `border-width-thick`, `duration-spin`, `duration-pulse`, `scale-shrunk`), Geist font entries; `standalone.mjs` reads the density. Rebuild the prototype once and check its smoke walk still passes. Satisfies **AC-2**
3. Copy the source, write `legacy.json` and `source.json`, run `tokens:build`. Satisfies **AC-1**, **AC-13**
4. `data-scale="app"` in `apps/web/index.html`, `usePublicScale`, the Storybook decorator. Tracer check: one app screen and one booking page show the right computed values. Satisfies **AC-5**, **AC-6**
5. Run `rename-0071.ts`; hand delete the press scale uses; fix the named lookups the tests flag (emails). Satisfies **AC-8**, **AC-10**, **AC-11**, **AC-12**
6. Fonts: files, fallbacks, preload, packs, OG cards, Storybook wait, tests. Satisfies **AC-9**
7. Lint: Stylelint refuses `zoom` and transitions on `filter` or `backdrop-filter`; 0002's renamed name fixtures updated (`duration-fast` is a real token again). Satisfies **AC-7**, **AC-11**
8. Contrast pairs for `canvas`, `surface-shell`, `primary`, `accent-text`, `warning`; any miss moves only that token's OKLCH lightness in the source, the smallest step, and the spec records it. Satisfies **AC-12**
9. Reshoot the 2,694 baselines in the pinned image, diff the folder, review a before and after sheet of a sample from every component folder in both themes, then commit. Satisfies **AC-14**
10. Full check, tests, size, build; `/check verify` against `verify.md`. Satisfies **AC-15**

## Migration plan

**Strategy**: one branch, one landing (the token names are global, so a partial landing would leave mixed names).
**Phases**: build on `feat/port-0`; land on `main` once CI is green and the screenshot review is done. Phases 1 to 9 branch from that.
**Rollback**: revert the one merge commit; the tokens, fonts and names come back together.
**Risks**: open branches using old names conflict (they rerun `rename-0071.ts` after rebasing); the app looks in between until phase 1 restyles components (new sizes on old component CSS).

## Consequences

**Positive**:
- The port copies prototype CSS as it is: same names, same units, right size.
- One number (`density-app`) moves both the artifact and the app.
- No zoom, so no React Aria placement patch and no drag maths.

**Negative / tradeoffs**:
- A token name is a step, not a pixel count in the app (`space-16` is 14px there). The usage note says so, and reviewers must remember it.
- App text gets smaller than today (body 13px → 12.5px, labels 11px → 10.5px, keycaps 9.5px). That is the size the owner approved, but it is small for long reading; browser zoom still works.
- Until phase 1, live screens show new sizes, Geist and new colours on old component designs.
- Public page motion becomes the app's scale (slightly faster than the tuned `public-*` values) and published pages using "Modern" change from Inter to Geist.
- Every open branch that touches CSS needs the rename script; `feat/marketing-redesign` is one.
- `legacy.json` is a second hand edited file until it empties.

**Neutral**:
- 2,694 baselines change in one commit.
- 0002's rule "a value is decided in the artifact" still holds; the artifact is now published from the repo folder rather than the other way round.

## Follow-up

- [ ] Publish the design system artifact from `design/timefix-design-system` after step 2, from the account that owns it (this session's account cannot open it), and set `source.json` `version`.
- [ ] `/sync`: AGENTS.md (fonts line, the token source), `packages/tokens/AGENTS.md`, the `crm-design-system` skill (scale rule, new names, `scale-press` gone).
- [ ] Mark 0002 as amended by 0071 (done in this change, status line).
- [ ] Start `docs/scope/port-ledger.md` from `parity-gaps.md` (handover) before phase 1.
- [ ] Each phase deletes the `legacy.json` entries it retires.
