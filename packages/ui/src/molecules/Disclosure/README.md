# Disclosure and DisclosureGroup

A section that opens and closes under its title.

## Why it exists

New. Attribute groups on the record panel (#18), advanced settings and import options (#13, #23) fold away the same way. It wraps React Aria's `Disclosure`, so the title is a real button with `aria-expanded`. Use Tabs when only one section should show at a time and they are peers.

## Use

```tsx
<Disclosure title="Contact" count={4} defaultExpanded>…</Disclosure>
<DisclosureGroup allowsMultipleExpanded>
  <Disclosure id="contact" title="Contact">…</Disclosure>
  <Disclosure id="billing" title="Billing">…</Disclosure>
</DisclosureGroup>
```

- `count` shows a Badge after the title, capped at 99+. With `countLabel` (what it counts, read after the number: "people") it shows whole however large, for a record's related section ("Team 150,000", spec 0017). Why a prop: a sidebar's counts are small and a cap keeps them quiet, while a related side's total is the point of its heading.
- `leading` goes before the title, inside the toggle: an account's ProviderMark in the calendars list. Why a slot: the account's heading is its fold, and the mark names the provider at a glance.
- In a `DisclosureGroup`, opening one closes the others unless `allowsMultipleExpanded`.
- `variant="fields"` stacks the panel's content `space-16` apart, as a `Form` stacks its fields: more fields folded inside a form ("Add more fields" in a create dialog, spec 0012). Why a variant: a Disclosure's panel lays out nothing, so fields inside it sat flush, unlike the form's own.
- `variant="label"` draws the title as a sidebar section label (11px, `text-secondary`, the chevron after it) with its items flush under it: the sidebar's Favorites, Records and Lists.
- `variant="quiet"` folds the rest of a list under one quiet line: Home's setup checklist's "2 done". The title is a control sized to its words, as quiet as a ghost Button ("Show 10 empty values" on a record page): `text-secondary`, with a pill and the text colour under the pointer only, never a full width bar. Its chevron is centred in a 16px icon's column on the content edge and its words start `space-12` after it, where a row's words start after its icon; the pill reaches `space-6` out past the column. The panel is flush, so the rows it holds line up with the rows above and keep their height. Why a variant: the default's full width title row, grey under the pointer, read as a stuck selected row inside a card, and its panel's inset pushed the folded rows 4px off the rows above (the owner, 22 October 2026). Under rows inset by `space-8` with a 16px control first (a TaskList's footer, which provides the `RowInset` context), its chevron sits on those rows' checkboxes and its words on their titles, and the pill reaches only `space-2` out, so the footer, which scrolls, never clips it.

- `headingLevel` sets the title's heading level where the default h3 would sit beside its container's own h3: 4 inside a Card (Home's setup checklist, spec 0041). Why a prop: the level depends on where the fold sits, which only the caller knows.
- `actions` (spec 0034): quiet controls after the title, outside its toggle (a sidebar section's grip and menu). In the `label` variant they show while the row is hovered or holds focus. Why: a section's menu can't sit inside the toggle button, and every sidebar section would otherwise draw its own heading row.
- Directly in a settings page's body (SettingsLayout sets the library's page edge) the default variant's title row runs out through the page's gutter like a Table's rows, a row's height, its chevron on the content edge and its count at the far one; its panel does too, so a Table inside it lines up with the one above it (Objects' Archived, 22 October 2026).

## States

Closed, open (the chevron flips and the panel's height tweens over `duration-fast` while its content fades in), hover (pointer only; the quiet variant's pill and text colour fade over `duration-hover`), focus, disabled. Reduced motion opens it at once.

## Keyboard

Tab reaches the title; Enter or Space opens and closes it.

## Differences from the artifact

Not in the artifact.

## Timefix prototype (spec 0072)

Takes its look from the prototype's Disclosure (accordion, `plain`): a `size-row` title row in `text-body-strong` with `radius-md` that washes `surface-hover` under the pointer over `duration-quick`; a `text-tertiary` chevron pointing down that flips through a flat line to point up as the section opens; the panel's height tweens over `duration-fast` on `ease-smooth-out` while its content fades in, and fades out as it closes (transitions.dev 21, accordion). Focus is the outline ring just inside the row, so the panel's clip never cuts it.


**Use it for** a block of settings or details someone opens when they need it ("Advanced", a role's powers, an archived list). **Don't use it for** the main content of a page, or a choice between views (Tabs).

**States**: closed, hover (the row washes), open (chevron up, content shown), focus visible, disabled. Reduced motion opens it at once and keeps the content's fade.

**Differences from the prototype**
- The chevron stays before the title (the prototype puts it at the row's end): a settings page's row keeps its count at the far end, and the quiet and label variants line their chevron up with the rows around them.
- The prototype's `card` look (a bordered card of rows) and `ShowMore` are not variants here; `quiet` stands in for ShowMore.
- Kept beyond the prototype: `variant` `label`, `quiet` and `fields`, `leading`, `count`, `actions`, the page edge run out and the row inset, `DisclosureGroup` with `allowsMultipleExpanded`.
