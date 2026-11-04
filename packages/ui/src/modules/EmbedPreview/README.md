# EmbedPreview

A made up site with the form on it, as the chosen embed draws it: the Share tab's picture beside its choices (T44, 5 November 2026, after Tally).

## Why it exists

New. Picking In the page, Popup or Corner button was a choice made blind: the tiles named three ways and the snippet changed, but nothing showed what a visitor to the site would see, and the Words and Colour fields changed nothing anyone could look at (critique b6). Nothing in the library draws a site: PreviewLayout and PreviewFrame frame a real page in a phone (a form inside a made up site is not a real page), ReadyPanel's preview is a slot, and a Card holds content rather than a picture of a page. It composes Skeleton for the site's lines and fields and adds only the frame, the form's box, the site's button and our corner button.

## Use

```tsx
<EmbedPreview
  mode="floating"
  headline="Tell us about your team"
  words="Talk to us"
  colour="#1f5fd6"
  label="How the form sits on your site"
/>
```

- `mode`: `inline` draws the form's box among the site's lines (its headline unless `isTitleHidden`, two fields and the button in the accent; with `isTransparent` no ground or hairline, so the site's background shows); `popup` draws the site's own button with `words`, plain, since its look is the site's; `floating` draws our corner button at the page's end corner in `colour` and `words`.
- `colour` is a `#rgb` or `#rrggbb` (anything else draws the accent), set through the CSSOM as `--brand-accent`, as the public pages' previews set theirs, with its words in white or ink, whichever reads better (`--brand-on-accent`), as the embed script picks them on the real site.
- It is one image (`role="img"`, named by `label`); nothing in it takes focus or a press.

## States

Each mode; inline clear or on its ground, with or without its headline; a corner button in the accent or in a colour. Light and dark take the theme's own surfaces.

## Keyboard

None: it is a picture.

## Differences from the artifact

Not in the artifact.
