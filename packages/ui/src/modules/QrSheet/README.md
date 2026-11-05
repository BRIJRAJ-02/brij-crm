# QrSheet

A printable sheet of table tent cards: Menu QR's print page (spec 0065, H2).

## Why it exists

New. Menu QR prints a code for every table (AC-6543: "a Print page lays out table tents, each with the logo, Scan for the menu and the table label; it prints from the browser with print CSS, no PDF service"). Nothing in the library lays out paper: QrCode draws one code, Card and TileGrid are screen surfaces with screen padding, and none knows A4, folding or print. A variant of QrCode would give an atom a page layout; a variant of Card would put print rules and a sheet grid into every card. So it is a module of its own, composing QrCode.

## Use

```tsx
<QrSheet
  venue="Somewhere"
  logoSrc={logo}
  cards={tables.map((table) => ({ id: table.id, name: 'Table 4', value: 'https://timefix.com/m/KEY?t=CODE' }))}
  perPage={2}
  colour={accent}
  controls={
    <>
      {perPageChoice}
      <Button onPress={() => print()}>Print</Button>
    </>
  }
/>
```

- `cards`: one per table, in order. `name` is the table as a guest reads it ("Table 4"), `value` the address its code opens.
- `perPage`: `2` (each card half an A4 sheet, a wide tent) or `4` (a quarter each, a small tent). A narrow card (under 480px, a quarter sheet or a phone) stacks the code over the words, centred, and leaves the logo out.
- `layout`: `tents` (the default, above) or `tiles`: flat stickers six an A4 sheet (two across, three down, AC-6543's stickers), each the table's name, the venue and its code, the code and the scan line, centred inside its own dashed cut edge; `perPage` is for tents only. Menu QR's print page opens on tiles with tents a choice, after checklabs' print sheet (5 November 2026). Why a variant: the same sheet, page and print rules with a second card shape, not a second sheet.
- A card's `code` is printed under the table's name (a tent) or after the venue (a tile), in the code type, so staff match a printed card to its table, as checklabs' sheet does.
- `logoSrc`: the venue's logo, from our own origin (`safeImageSrc`); it sits above the venue's name and in the code's centre. Without one, the venue's initial in a round mark, and a plain code.
- `colour`: the modules' colour, only while it keeps 4.5 to 1 on white (QrCode's rule); otherwise black.
- `controls` and `actions`: what sits above the sheets on screen, at the start (a way back, a summary) and at the end (the per page choice, Print); `notice` a line under them (the menu isn't live). None of them prints.
- Each card is two faces with a dashed fold line between them; the back face is drawn upside down, so once folded into a tent both sides read the right way up. The card's own dashed edges are the cut lines.

## Print

A named page (`page: qr-sheet`, `@page qr-sheet`) is A4 with no margins, so nothing else in the app prints differently; each sheet is the page's whole width at A4's ratio with a page break after it, so one sheet fills one printed page, and its cards sit inside a `space-32` margin (about 8mm) that home printers can reach. In print the controls, the grey ground and the paper shadow go. The sheet carries `data-theme="light"` and every code `ground="paper"`, so a dark app prints (and previews) on white.

## States

One state: drawn. With no cards it draws no sheet (the caller shows its own empty state instead). Not interactive; the controls have their own states.

## Keyboard

Nothing in the sheet takes focus; the controls do.

## Accessibility

Each sheet is a region named "Page 1 of 3", each card an article named by its table, and each code an image named "QR code for Table 4". The back face is hidden from screen readers, since it repeats the front.

## Differences from the artifact

Not in the artifact yet; it goes with the next `pnpm ui:artifact`.
