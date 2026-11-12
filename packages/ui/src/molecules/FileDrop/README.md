# FileDrop

Drop files here or browse for them.

## Why it exists

New. Imports (#30) and file attributes (#32) take files the same way, and say up front which types and sizes they accept. It wraps React Aria's `DropZone` and `FileTrigger`, so dropping works by keyboard and screen reader too (paste or the browse button).

## Use

```tsx
<FileDrop label="Upload a CSV" acceptedTypes={['text/csv', '.xlsx']} maxSize={50_000_000} onFiles={start} />
```

- `acceptedTypes` takes MIME types or extensions; `maxSize` is in bytes and shows as "up to 50 MB".
- A file of the wrong type or over the size is refused with a sentence on what to do; `onFiles` only gets files that pass.
- `allowsMultiple` takes several at once; otherwise the first.
- `isReadOnly` draws only the picture that is there (`preview`), at a control's height, with nothing to press: a member's view of the workspace's logo. With no preview it draws nothing, and the screen says so.
- `typesText` names the accepted types as people say them ("PNG, JPG or WebP") in the hint and the refusal, where the raw `acceptedTypes` would read `image/png, image/jpeg`.
- `wrongTypeText(fileName)` lets the screen say something better than "Choose .csv" for a type it can name (the import page: an Excel file, and how to save it as CSV); answering undefined keeps the built in sentence.

- `variant="button"` (27 October 2026) is the browse button alone, `label` its words, with `isPending` while what was picked is on its way: for a picker beside the thing it changes, first run's avatar, where a drop area would draw the picture a second time. Same type and size checks, same refusal line under it. Why a variant, not a new component: it is FileDrop's own FileTrigger and checks with the drop area taken away; a second file picker would have checked files a second way.
- `variant="row"` (5 November 2026, the link page's calm editor) is one line at a row's height: a small wide picture of what is there (or the upload mark), the label, and Upload (Change once there is one; named "Upload cover photo", so two rows on a screen never share a name), Adjust crop with `onAdjust` and a remove button (the base set's `x`, since the hosted form draws FileDrop with no registry) with `onRemove` at its end; pressing remove moves focus to Upload (10 November 2026), since the remove button goes with the picture. It is still a drop target. The accepted types and size are said only in its refusal line, not up front. For an optional picture in a settings card (a link page's cover, its share picture), where the zone's dashed box was the loudest thing on the screen. Why a variant: the same checks, refusal line and drop target, only laid out on one line.
- `description` on the row (9 November 2026, the link page's three photos) is one quiet line under the label saying what the picture is for ("The wide banner across the top"), and describes the row's Upload or Change button (React Aria's DropZone drops `aria-describedby`, and its focusable part is its own hidden button). Why a prop: a card with a cover, a profile photo and a background photo read as three rows alike, and people couldn't tell which did what (owner's team, 9 Nov); a hint beside the row would have sat outside the row's own text column.
- With `thumb="square"` the row keeps the wide tile's width for its picture column (the square at its start), so a square row among wide ones lines its label up with theirs (9 November 2026, the link page's profile photo between its cover and background).
- `onAdjust` (4 November 2026, spec 0068 AC-6809) adds "Adjust crop" beside browse while a `preview` shows (a ghost button beside the browse button with `variant="button"`), so a picture already there opens the screen's PhotoCrop again. Why a prop, not a button the screen draws: every picture picker in the app is a FileDrop, so the second way in sits in the same place on each of them.

- `isPending` on the zone (31 October 2026, spec 0061's link page pictures): the zone stays put, its words say "uploading…", it is busy and takes no drop, and its browse button keeps focus but takes no second pick. Why: swapping the zone for a skeleton while a picture uploaded unmounted the button that had focus, and the form jumped by the zone's height twice.
- `error` (31 October 2026): the screen's own refusal ("Add a picture.") in the zone's refusal line, so it reads as this control's error, not a note beside it.

- `variant="photo"` (6 November 2026, a menu item's photo) is one picture a screen has to show well. With nothing there, one box to press, drop on or paste into ("Add photo", "Drop, paste or click"), and a picture pasted anywhere in the dialog around it lands here, so nothing has to be focused first; text pasted into a field stays the field's, and a dialog opened over this one keeps its own paste. With a picture there, the picture `size-column` wide at 4:3, with Change, then Adjust crop (`onAdjust`) and Remove (`onRemove`) under it. Read only, the picture alone at that size. Why a variant: the row's 40px tile can't be checked by eye, and the zone holds a picture at a control's height. The same checks, refusal line and drop target. One `photo` per dialog: two would both take the same paste. Its box hides React Aria's own hidden drop button from Tab (the first button inside it), so check that after a React Aria upgrade.

## States

- Its hint reads "Drag a file here, or browse" when it takes one file and "Drag files here, or browse" with `allowsMultiple` (QA, 22 October 2026).

Idle, with a preview, drag over (accent), focus, uploading (`isPending`), refused (the error under it, or the screen's own `error`), disabled.

`preview` (26 October 2026) draws the picture that is there already in the upload icon's place, for a single file
picker that replaces one: a page's share image, and later an avatar or a logo. Somebody should see what they are
about to replace. It goes through `safeImageSrc` as every image in the library does, so only our own origin, a
`data:` or a `blob:` is ever drawn, and it falls back to the icon without a word if the image won't load, since a
broken picture inside a drop box reads as a broken control.

## Keyboard

Tab reaches the box and the browse button; Enter on browse opens the file picker. Pasting files into the focused box drops them.

## Differences from the artifact

Not in the artifact.

## Square thumb

`thumb="square"` with `variant="row"` draws the picture in a square tile (`avatar-title`), for a picture you have to recognise, which the row's wide strip would cut to its middle (a menu item's photo, 6 November 2026). Left out, the wide strip, for a logo or a banner.

## Timefix prototype (spec 0072)

Takes its look from the prototype's FileDrop: a `radius-lg` zone on the surface with a dashed `border-strong` edge, the upload mark on a round `surface-subtle` tile a control tall, the label in `text-body-strong` and the hint, the browse link and the limits in `text-body-sm`. A file over the zone turns the edge `accent` on an `accent-soft` wash, and the tile white with the mark in `accent-text`, lifting by `distance-micro` on the bounce curve (movement dropped under reduced motion). The `photo` variant's empty box is the prototype's compact zone (the same dashed edge, a small round tile); `row` keeps its one line. Focus is the outline ring on the zone, the row, the photo box and the browse link.

**Use it for** attachments, a form's file question, logos and imports. **Don't use it for** a link to a file elsewhere (a URL field).

**States**: rest, files over it, focus visible, disabled (a solid `border-subtle` edge, the words at `text-tertiary`), sending, refused (the error under it).

**Differences from the prototype**
- "browse" stays a link inside the hint rather than the prototype's Choose files button.
- The preview of what is there already takes the mark's place, at most two rows wide and a row tall.
- Kept beyond the prototype: `preview`, `onAdjust`, the `row` and `photo` variants, `isReadOnly`, `isPending`, the limits line.
