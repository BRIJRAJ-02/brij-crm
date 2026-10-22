# SiteFooter

Every page's footer: the brand with the way into the dashboard, the ways in, the legal pages, and the copyright line with every feature a click away.

## Why it exists

The owner asked for "a proper footer" with the link to the dashboard, aligned with the dashboard, and for the existing privacy and terms pages (23 October 2026). Google's OAuth verification also needs the privacy page linked from the home page. It follows Attio's and Linear's footers: the brand on the left, columns of links on the right, the copyright line under a hairline. Its links are drawn as the app's sidebar rows (the item's height, the hover surface, the library's focus ring); the library's `Link` atom is for inline text and opens every `https` link in a new tab, which is wrong for site navigation. The dashboard's button is the library's ButtonLink.

## Use

```tsx
<SiteFooter year={2026} />
```

The owner asked for the product's areas to come out of the footer (23 October 2026); they live in the All features panel.

## States

Links take the sidebar's hover surface (only where the device can hover) and the library's focus ring. The button's and the All features trigger's states are their own.
