# FormPicture

A form in miniature, for LinkCard's `picture` on the forms list (Captures › Forms): the form's mark, name and question count over its first questions drawn as shapes, and a button in the form's colour. BookingPagePicture's sibling, so the two lists' cards read as one family.

## Why it exists

New on 5 November 2026. The owner, pointing at the booking pages' cards: "make something like this for forms as well". The forms list drew each form with `HostedFormPreview size="thumbnail"`, a light, literal render of the form's real words, which looked like a different product beside the booking cards' abstract month.

- BookingPagePicture draws a month, not a form, and a variant would make one part draw two unrelated pictures.
- HostedFormPreview draws the real thing: real words, the form's own Light or Dark, its real controls. Too literal for the family, and it carried each form's labels, choices and button words to the list.
- FormLayoutThumbnail draws a layout's frame (the builder's Layout picker), not a form's questions.

So it is a drawing, as BookingPagePicture is: the form's name and count are its only words, and each question is a shape for its kind.

## Use

```tsx
<LinkCard
  …
  picture={
    <FormPicture
      title={form.name}
      count="4 questions"
      fields={[{ kind: 'text' }, { kind: 'choices', count: 3 }, { kind: 'rating' }]}
      hue={linkHue(form.id)}
    />
  }
/>
```

- **`title`** and **`count`:** the form's name and its question count, worded by the caller, each on one line, cut when long.
- **`fields`:** its first questions as shapes, top to bottom; the first two are drawn, then the button, so the colour always shows above the stage's foot.
  - `text`: a label bar over a field.
  - `long`: a label bar over a taller field.
  - `choices` (`count`): a label bar over two or three pills, the first picked in the colour.
  - `rating`: a label bar over five dots, three lit in the colour.
  - `check`: a label bar over a box and a line (a checkbox, yes or no, a consent).
- **`hue`:** the form's colour. A form has none of its own, so the caller passes `linkHue(form.id)`, as the booking card does with a page's id: the mark, the picked pill, the lit dots and the button.

## States

Each field kind; more questions than fit (the first two); no questions (the name and the button alone); a long name (cut); each hue. A paused form's card greys its stage (LinkCard's off state), so the picture never says a state itself. It never moves: hover lifts LinkCard's sheet, not the picture.

## Keyboard

None: it is a picture inside LinkCard's stage, hidden from assistive tech and inert. The card's title names the form.

## Differences from the artifact

Not in the artifact yet.
