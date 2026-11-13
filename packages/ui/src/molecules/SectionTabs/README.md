# SectionTabs

A long page's sections as a row of pills that follow the reader (spec 0065, AC-6529; spec 0068, AC-6803 and AC-6806):
each pill links to its section's anchor, the current one is filled in the text colour, and the fill slides between
pills as the page scrolls (transitions.dev's tabs sliding), the row scrolling sideways to keep it in view. The guest
menu's sticky bar uses it; a business page's sections can too.

## Why a new part

Tabs switch panels in place (a tablist, arrow keys move the choice), and SegmentedControl is a radio group: both
choose. Here the page stays one page and each pill is a link to a place on it, which a reader can open, copy or
follow, so it is a navigation of links whose current one is the section in view (`aria-current="location"`), and the
caller says which that is (a scroll spy). Neither existing part could become that with a variant.

## Use

```tsx
<SectionTabs
  label="Sections"
  sections={sections.map((section) => ({ id: section.id, label: section.name, href: `#s-${section.id}` }))}
  current={inView}
/>
```

- The fill's first place is drawn at once; after that it slides in `duration-fast` on the ease in out curve, its
  width following the pill's. A face that loads late or a resized window moves it at once.
- `onSelect` hears a press first: the caller may scroll smoothly itself, or leave the anchor to jump.
- Colours are the surface's: the fill is `text`, the chosen words `surface-raised`, the others `text-secondary`, so
  a page that points those at its own look (the guest menu's Warm look) wears it.

## States

Current (filled), other (quiet; `text` under the pointer), focus (the focus ring), none current (no fill), and reduced
motion (the fill moves at once). Forced colours draw the fill in Highlight.

## Keyboard

Tab moves through the links; Enter follows one.

## Differences from the artifact

Not in the artifact yet; it goes with the next `pnpm ui:artifact`.
