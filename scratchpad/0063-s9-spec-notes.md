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

## 5. The brand's text colour on the hosted form's primary button, in the form's dark Colour

Seen in the shots `scratchpad/s9-shots/s9-brand-form-light.png` and `…-dark.png`, both of a form wearing the kit
`#e8590c` (whose guard picks `#000000` as the text on the accent in both modes):

- light Colour: the Send button is the brand orange with a near-black label. Right.
- dark Colour: the Send button is the brand orange with a near-white label. That pair is about 3.3:1, under the
  4.5:1 spec 0060 AC-5 promises for text on the accent.

The fill is the kit's own colour in both (asserted in `Brand.browser.test.tsx`), so the brand reaches the control;
it is only the label's colour that seems to fall back to the product's.

Honesty about the diagnosis: I could not pin it down. `getComputedStyle` at the button reported
`--on-accent: light-dark(#000000, #000000)` — the right value — while reporting the drawn `color` as the theme's
text colour, and an inline `color: light-dark(#000000, #000000)` on that same button did not change what it
reported either, which an inline declaration always should. So my measurements of that element contradict
themselves and I do not trust them; the screenshots are the solid evidence. This is spec 0060's wiring
(`FormParts.module.css`, `--form-brand-on-accent` → `.card`'s `--on-accent`), not anything slice 9 added — slice 9
only makes it reachable by choice rather than always.

Owed: someone with 0060's CSS in hand should check the dark pair on the hosted page, since AC-6327 leans on that
guarantee. Nothing was changed for it here.
