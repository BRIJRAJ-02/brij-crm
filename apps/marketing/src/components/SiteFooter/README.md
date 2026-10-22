# SiteFooter

Every page's footer: the brand with the way into the dashboard, the ways in, the legal pages, and the copyright line with every feature a click away.

## Why it exists

The owner asked for "a proper footer" with the link to the dashboard, aligned with the dashboard, and for the existing privacy and terms pages (23 October 2026). Google's OAuth verification also needs the privacy page linked from the home page. It follows Attio's and Linear's footers: the brand on the left, columns of links on the right, the copyright line under a hairline. Every link is a library ButtonLink: the dashboard's a `secondary` `lg`, each column's rows `ghost` (the app's quiet row, pulled `space-8` to the start so its label lines up with the column's heading). The library's inline `Link` is for text, so it isn't used for navigation here.

## Use

```tsx
<SiteFooter year={2026} />
```

The owner asked for the product's areas to come out of the footer (23 October 2026); they live in the All features sheet.

## States

The ButtonLinks' own (hover where the device can, the library's focus ring). The All features trigger's states are its own.
