# ReadyPanel

The "done, here is your link" moment after a booking page, a form or a link page is created (spec 0058, AC-5 and AC-6).

## Why it exists

New. Nothing in the library showed a finished thing with its link: LinkCard shows an existing link small, QrCode is only the code, and a Modal is only the frame. After creating something people hunted for the address, so the moment is one module: a quiet success mark and one heading, the link with Copy and Share, its QR code, a preview, and room for more (a form's three embed tiles). It only composes CopyButton, Button, QrCode and Icon; it adds no control of its own. Reuse and variant were tried first: LinkCard is a list card (switch, facts, actions) and bending it into a panel would have forked it.

## Use

```tsx
<Modal
  title="Your booking page is ready"
  isOpen
  actions={
    <Button variant="primary" slot="close">
      Done
    </Button>
  }
>
  <ReadyPanel
    message="Anyone with the link can book."
    link="https://timefix.com/b/k3x9"
    preview={<PreviewFrame src="/b/k3x9" title="Intro call" />}
    previewScale="shrunk"
    copyVariant="secondary"
  />
</Modal>
```

- One column on one left and right edge, blocks `space-16` apart. The link row, Copy and Share are `size-control` tall.
- The mark is a tick on the green tag's ground, line and text at `size-control-sm`, not a filled `success` disc: at full strength it was the one strong green in the product and the loudest thing on the dialog (owner, 1 November 2026).
- `title` is the one heading. Inside a Modal, leave it out and let the Modal's title say it, so the dialog has one heading; the mark then sits beside `message`, in the text colour.
- `link` is shown, cut in the middle when the field is short (the start up to the last slash gives way to an ellipsis, the page's own name always shows), copied (Copy swaps to a tick and "Copied" for two seconds, announced as "Link copied"), shared, and drawn as the QR code.
- Share uses `onShare` when given, otherwise the browser's share sheet, and is left out where the browser has none. A closed sheet is not an error.
- `preview` is a framed slot at the QR's height beside it (below it in a narrow slot), named by `previewLabel`. It is at most `size-column` tall: a taller picture (a whole phone) is cut there, its top kept in view. The preview is inert: nothing in it takes focus, a press or a scroll. `previewScale="shrunk"` lays a whole page out at twice the slot and draws it at half (`scale-shrunk`) from its top, so its head (a booking page's name and title) shows instead of being cut. Without one the QR stands alone, centred in its band: the line that told people to point a phone's camera at it went on 1 November 2026, because a QR explains itself, and a small code left at the edge of an otherwise empty row read as a layout fault.
- Copy is primary by default. In a Modal whose footer has its own primary (Done), pass `copyVariant="secondary"` so the dialog keeps one primary.
- `children` come below (embed tiles: `TileGrid variant="choice"`); `actions` sit at the end.
- Motion: the panel eases in on opacity and a `space-8` rise, and the mark pops on opacity and scale, from the modal's duration and curve. Under reduced motion both appear at once, with no fade (spec 0058, AC-2).
- The caller passes the address it already has; the panel makes no request.

- `variant="share"` makes the link the hero, as Tally's and Typeform's share screens do: the address (the host muted, the page's own name strong) with Copy link beside it, both `size-control` tall with one radius; under it one row of equal buttons, Email (a `mailto:` titled `shareTitle`), WhatsApp and More (the device's share sheet, only where there is one), each as wide as the widest word needs, from the left edge; and the QR code beside them on a light tile of its own (`QrCode ground="clear"` inside a tile carrying the light theme: the surface with a hairline in a light app, the light theme's sunken grey-blue in a dark one, softer than white and about 15 to 1 against the modules), with Download right under it: a SplitButton whose one press saves the PNG and whose menu beside it holds Download SVG (spec 0074, 13 November 2026: a download is one press, as the link page's was), each handing `onDownloadQr` the code's own SVG, both halves busy while it runs. From 480px of its own width the link and the ways sit in a column from the top, beside the code on the panel's right edge (a Share tab card, a 560px dialog); narrower (a phone) the code drops to a row at the foot with Download beside it, Download wrapping under the code where the row can't hold both, and the ways take the column's width; under 320px they stack, one a row. Then `onward`, one row with a chevron to somewhere else ("Put it on your site"), a routed link that also runs its `onPress` (closing the dialog it sits in). With neither `title` nor `message` the panel draws no head, so a dialog whose title already says "<Form> is live" says it once. A form's live dialog and its Share tab both draw it (the owner, 5 November 2026: the centred column before it floated in an over wide card, the code sat on a grey slab in dark, and its download was a fourth equal button away from it). Why a variant: the same link row, Copy and address cutting; the order, the button row, the code's tile and the onward row are what change, and a column of its own in the app would have drawn buttons the library already has.
- `invite` (with `share`): words written before the link in the Email and WhatsApp messages ("Pick a time that suits you:"), so the message says what the link is for. ShareSheet passes its own `invite` here (spec 0073, batch 2). The link stays last, so a message cut short by a mail app still ends on it.
- `qrStyle` (with `share`): the code in a saved style, the modules' colour, a centre picture and a frame label (spec 0061, AC-6124), as QrCode takes them. On screen and in what Download saves, since the download reads the code drawn. ShareSheet passes its own `qrStyle` here (spec 0074, AC-7403), for the link page's styled code.

## States

Always ready: it only appears once the thing exists, so it has no loading or error state.

## Keyboard

Tab goes Copy, then Share, then the caller's buttons. With `share`: Copy link, Email, WhatsApp, More, Download PNG, then its menu (Enter or the arrows open Download SVG), then the onward row. The address is selectable text (a click selects all of it) and is not a tab stop.

## Differences from the artifact

Not in the artifact.
