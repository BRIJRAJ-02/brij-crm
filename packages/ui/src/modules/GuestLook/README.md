# GuestLook

The guest pages' one look (5 November 2026): what the guest menu wears, around a page built from the booking parts, so the menu, the reservation page and the business page read as one product.

## Why it exists

New. The first go gave BookingFrame, BookingMessage, BookingReceipt and BusinessPage each a `look` prop and the same block of CSS, which put a restaurant's look into the approved booking page's stylesheet and took that page past its CSS budget. Every part already reads the library's own names (`surface-raised`, `text`, `accent`), and BookingFrame works its accents out from them, so one wrapper that points those names elsewhere dresses them all, with nothing in the parts it dresses. A page without it carries none of its styles.

## Use

```tsx
<GuestLook>
  <BookingFrame … />
</GuestLook>
```

The page links the look stylesheet itself (`/api/public/tables/<key>/look.css`, `/api/public/business/<handle>/look/menu.css`), which sets the `--menu-*` custom properties on the root, with the brand's accent in `--menu-accent`. With none linked, each colour falls back to a token and the accent to the ink (`surface-inverse`, near black in light and near white in dark), never the app's blue. BusinessPage wears it itself.

## States

No state of its own: it holds no data and draws no box (`display: contents`). Dialogs open inside it (React Aria's portal provider), so they wear the look too.

## Differences from the artifact

Not in the artifact.
