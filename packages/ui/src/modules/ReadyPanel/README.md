# ReadyPanel

The "done, here is your link" moment after a booking page, a form or a link page is created (spec 0058, AC-5 and AC-6).

## Why it exists

New. Nothing in the library showed a finished thing with its link: LinkCard shows an existing link small, QrCode is only the code, and a Modal is only the frame. After creating something people hunted for the address, so the moment is one module: a success mark and one heading, the link with Copy and Share, its QR code, a preview, and room for more (a form's three embed tiles). It only composes CopyButton, Button, QrCode and Icon; it adds no control of its own. Reuse and variant were tried first: LinkCard is a list card (switch, facts, actions) and bending it into a panel would have forked it.

## Use

```tsx
<Modal
  title="Booking page created"
  isOpen
  actions={
    <Button variant="primary" slot="close">
      Done
    </Button>
  }
>
  <ReadyPanel
    title="Your booking page is ready"
    message="Anyone with the link can book."
    link="https://timefix.com/b/k3x9"
    preview={<MiniPage />}
    copyVariant="secondary"
  />
</Modal>
```

- One column on one left and right edge, blocks `space-16` apart. The link row, Copy and Share are `size-input` tall.
- `link` is shown, copied (Copy swaps to a tick and "Copied" for two seconds, announced as "Link copied"), shared, and drawn as the QR code.
- Share uses `onShare` when given, otherwise the browser's share sheet, and is left out where the browser has none. A closed sheet is not an error.
- `preview` is a framed slot at the QR's height beside it (below it in a narrow slot), named by `previewLabel`. It is at most `size-column` tall: a taller picture (a whole phone) is cut there, its top kept in view.
- Copy is primary by default. In a Modal whose footer has its own primary (Done), pass `copyVariant="secondary"` so the dialog keeps one primary.
- `children` come below (embed tiles: `TileGrid variant="choice"`); `actions` sit at the end.
- Motion: the panel eases in on opacity and a `space-8` rise, and the mark pops on opacity and scale, from the modal's duration and curve. Under reduced motion both are a fade.
- The caller passes the address it already has; the panel makes no request.

## States

Always ready: it only appears once the thing exists, so it has no loading or error state.

## Keyboard

Tab goes Copy, then Share, then the caller's buttons. The address is selectable text (a click selects all of it) and is not a tab stop.

## Differences from the artifact

Not in the artifact.
