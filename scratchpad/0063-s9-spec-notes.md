# Spec 0063 slice 9, notes for /architect

Built on `wip/0063-s9` (off `wip/0063-s5`). Nothing under `docs/specs/` was touched.

## 1. AC-6327 names a font pack the brand kit does not have

AC-6327 says Brand is "the workspace brand kit of spec 0060: accent, logo, font pack", and the Feature design row
says `PublicForm.brand` carries "resolved colours, logo and font pack names".

Spec 0060's kit has no font. `workspace_brands` (migration `0155_brand_kit.sql`) holds `accent`, `accent_dark`,
`logo_path`, `logo_type`, `logo_version` and nothing else; the eight font packs of 0060 AC-12 are a **link page**
key (`public_profiles.theme.font`), never a workspace-wide one. Giving a form a brand font pack therefore needs
either a new `workspace_brands.font` column (a migration, which this slice is not allowed to add and which is
contested across chats right now) or a decision to read the owner's link page font, which would be a new coupling
nothing in either spec asks for.

Built: Brand = the workspace accent pair + the workspace logo, both already resolved server side by 0060's
`readFormBrand`. `PublicForm.brand` is unchanged (`{ version?, logo? }`) and still carries no raw CSS.

Owed: a decision on whether the brand kit gains a font pack (`workspace_brands.font`, its picker in Settings ›
Brand, the preload in the form shell), or whether AC-6327's "font pack" is struck. Either way it is a migration and
a 0060 amendment, not a 0063 one.

## 2. The contrast guard can only fail on a row that never went through the picker

AC-6327 says 0060's guard applies so "no unreadable pair can be published". 0060's guard (`brandVariables`) does not
refuse colours: it moves lightness until every pair meets AA, and it is proved to by a property test over thousands
of hexes. The only way a form's publish can meet an unreadable pair is a `workspace_brands.accent` that is not a
checked six digit hex, and Postgres' own check constraint on that column already refuses one.

Built anyway, because the criterion asks for the guard on this path and not only on the kit's screen:
`unreadableBrand()` in `packages/contracts/src/forms/publish.ts`, called by `publishProblem` whenever the draft's
look is Brand, with the kit read on the publish path (`publishForm` → `brandRowOf`). It refuses with code
`BRAND_UNREADABLE` on field `look`.

Consequence for `verify.md`: the "publishing a form with a failing brand pair is refused" scenario can only be
written as a unit test of `publishProblem` with a pair the database would not hold. There is no reachable database
state that fails it, which is the right answer, but the verify pass should expect a unit test there, not a
database one.

## 3. `look.theme` is absent, not `'plain'`, on older documents

The Feature design row says `look` gains `theme: 'plain' | 'brand'`, "`'plain'` for existing forms". It is
implemented as **optional**, with absent read as plain everywhere. A `.default('plain')` would have made `theme`
a required key of the parsed type and so rewritten a dozen fixtures across three packages, including files other
chats own this week. Behaviour is identical; the wire shape is smaller.

## 4. The brand stylesheet and logo routes are not gated on the look

`/api/public/forms/:key/brand.css` and `/logo` still answer for a plain form's workspace if asked with the right
`?v=`. The form's own read no longer names that version to a plain form's page, and the version is 12 hex
characters of a SHA-256, so nothing can reach it by guessing; the content is the workspace accent, which any
branded page of that workspace shows publicly. Gating them would cost a second read of the live version on a hot
public route. Flagged in case the verify pass wants it closed anyway.

## 5. A shot taken in the browser harness can show a cascade production never has

While shooting the branded form I photographed what looked like a contrast failure: in the form's dark Colour the
Send button drew the brand orange with a near-white label (about 3.3:1, under the 4.5:1 spec 0060 AC-5 promises),
while light drew it near-black. It is **not** a production bug, and the chase is worth writing down because the
same trap is set in several other test files.

What it was. `packages/ui/src/styles/index.css` opens with `@layer reset, tokens, base, components, utilities;`,
and a layer's place in the cascade is fixed by its **first appearance** — a later statement can append names but
never reorder ones already seen. My test imported `./hosted-form.ts` before `../styles/index.css`, so the
components' own CSS modules were injected first, `components` was registered before that statement, `reset` landed
*after* it, and reset's `button { color: inherit }` then beat the primary Button's `color: var(--on-accent)`. The
label inherited the page's text colour. The fill stayed right because `background` comes from the same rule but is
not something the reset sets. Moving the stylesheet import to the top of the file turns the label black
(`rgb(0, 0, 0)`, the colour the guard chose) and sharpens the rest of the shot too — the headline was at the wrong
weight in the earlier ones for the same reason.

Production never has this order: the built pages link `/layers.css` from their head (`layerOrder()` in
`apps/web/vite.config.ts`), before any module CSS, and the app's `main.tsx` imports `@crm/ui/styles.css` first.

What was ruled out along the way, each by measurement, so nobody repeats it: `brandVariables` answers
`onAccent: "#000000"` for both halves of this accent; `brandProperties` emits all six names and `rootBlock`'s
filter accepts them, so the served `brand.css` is not implicated; `--form-none` is never reached (a bare probe
inside the same card painted `var(--on-accent)` as black, so the `light-dark()` chain resolves); and the white was
not the product's `--on-accent` (`#fcfdff`) but `--text` (`#ebedef` dark, `#18191d` light), which is inheritance,
not a fallback.

Two things owed from this, neither in this slice:
- `Brand.browser.test.tsx` now imports the stylesheet first and asserts the label's colour, so the pair is held.
  **The other `packages/ui/src/public-form/*.browser.test.tsx` files still import it last**, so their shots carry
  the same wrong cascade. Worth a sweep.
- Nothing in the product changed. `--on-accent` (`#fcfdff`) and `--text` in dark (`#ebedef`) are near-identical,
  so had this been real on the product's own colours nobody would ever have seen it; a brand whose guard picks
  black is what made it visible at all.
