# ShareSheet

The one share dialog (spec 0073, batch 2): every Share button opens it, and so does a thing's first publish.

## Why it exists

New, as the prototype's ShareSheet (spec 0073's mapping, row 23). Five screens build a share dialog by hand today: the forms' live dialog and Share tab (`ShareBlock`), the link page's Share modal, the booking pages' Share menu, and the Copy link buttons on menus and the business page. Each draws the ways to share a little differently. ShareSheet is one module for all of them, so phase 3 can put it behind every Share button.

It adds no CSS and no control of its own. Reuse came first: ReadyPanel's `share` column already draws exactly the prototype's layout (the QR code on its light tile with Download under it, the link with Copy link, one row of Email, WhatsApp and More, and the onward row), and the forms' live dialog already draws it inside a Modal. ShareSheet is that composition in the library, with the parts the prototype adds: `invite` (a new ReadyPanel option, words before the link in Email and WhatsApp), the thing's own ways in a ButtonGroup row, a footer line in the Modal's `hint`, and the address gate. A second share layout beside ReadyPanel's would have been two looks for one moment.

Use it for sharing any public page: a form, a booking page, the link page and team pages, a menu, the business page. Don't use it for inviting people into the workspace (InviteRows) or for Insights' named, revocable links (their own dialog).

## Use

```tsx
<ShareSheet
  isOpen={isOpen}
  onOpenChange={setOpen}
  title="Share Discovery call"
  url="https://timefix.com/priya/discovery-call"
  name="Discovery call"
  invite="Pick a time that suits you:"
  embedHref="/w/acme/bookings/discovery-call/embed"
  extra={<Button variant="ghost" icon="calendar-clock">Offer specific times</Button>}
  footer="Bookings go to your calendar"
/>
```

- `url` is the whole public address, scheme and all. Where the prototype took the address without `https://`, this takes it whole, as ReadyPanel and the link page's Share modal do, so the code, the copy and the messages carry exactly what the screen read.
- `url` passes `shareableUrl` before anything is drawn, copied, shared or encoded into the QR code: the library's `safeHref`, then only `http:` or `https:` (a path, `mailto:` or `tel:` means nothing on another device). A `javascript:`, `data:` or `vbscript:` address draws one danger Callout ("This link can't be shared, because it isn't a web address.") and Done, and nothing else, not even the footer (spec 0073, AC-7318). `share-url.test.ts` proves each scheme is refused and `https:` passes; the `Refused` stories prove nothing is drawn.
- `name` is what is shared: the email's subject, the device share sheet's title, the QR code's name ("QR code for Discovery call") and its file ("discovery-call-qr.png").
- `invite` puts words before the link in Email and WhatsApp. The link stays last.
- `embedHref` draws "Put it on your site" (ReadyPanel's onward row) for a thing that embeds; following it closes the sheet.
- `extra` is the thing's own ways, in one row named "More ways to share": ghost Buttons for an action (Offer specific times, Style the code) and ghost ButtonLinks for a place (Open page), as the prototype draws them, so the row stays quieter than Copy link. Only ways to share go here; anything else (Turn on Live) goes in `footer`.
- `footer` is one quiet line at the footer's start, beside Done ("Answers go to People · Change"), the Modal's `hint`.
- `qrStyle` draws the code in a saved style (the link page's colour, centre picture and frame label, spec 0061, AC-6124), on screen and in the saved PNG or SVG (spec 0074, AC-7403). Left out, the plain code.
- Copy link is the sheet's one primary; Done is secondary and takes focus as the sheet opens, so Enter and Esc both close it. Download saves the code as a PNG or an SVG through `downloadQr` (beside QrCode, `atoms/QrCode/qr-file.ts`); if the browser refuses, a toast says so.
- It makes no request and reads no setting: the caller passes the address it already has.

## ShareColumn

`ShareColumn` is the sheet's body on a page of its own: a Share tab (a form's, a booking page's) draws the same ways to share in its card, so the tab and the sheet can never drift (spec 0074, AC-7402). It takes `url`, `name`, `invite`, `embedHref` (with `onEmbed`, called as the row is followed), `extra` and `qrStyle`, passes the same address gate, and saves the code the same way. ShareSheet draws it inside its Modal. A caller composing ReadyPanel's `share` column itself would have to repeat the address gate (`shareableUrl` is not exported), the download and its failure toast, and the words, which is what the forms' hand made `ShareBlock` was, so the column is exported once here instead.

## Load

Out of every first load. Nothing a first load draws imports it: it is exported from `@crm/ui` (tree shaken, `sideEffects` lists only the root stylesheets), so it travels in the chunk of the screen that opens it, with QrCode and `uqr`. `apps/web/build.test.ts` asserts its words never reach `index.html`, `book.html` or `form.html`'s first load (spec 0073, AC-7314).

## States

Open (the link, the QR code, the ways, Download), styled (`qrStyle`), with an invite, with "Put it on your site", with the thing's own ways and a footer, refused (an address that isn't a web address), and closed. Copy's Copied tick, Download's busy state and its failure toast come from CopyButton and ReadyPanel.

## Keyboard

Focus opens on Done. Tab goes the title bar's close button (×), Copy link, Email, WhatsApp, More (where the device has a share sheet), Download (Enter or the arrows open PNG and SVG), Put it on your site, the thing's own ways, then Done. Esc closes.

## Differences from the artifact

The prototype's `onSite` callback is `embedHref` (a routed link that closes the sheet, as the forms' live dialog has it), its `url` carries the scheme, its Done is secondary (Copy link is the one primary), and its lines of explanation under the code are left out (a QR explains itself, the owner, 1 November 2026). Not in the artifact yet; it goes with the next `pnpm ui:artifact`.
