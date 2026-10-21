# Avatar and AvatarStack

A person's or company's picture, or their initials on a hue tile; and a few of them overlapping.

## Why it exists

Ported from the artifact's Avatar card. Record chips, the record header, presence, comments and assignees all draw people and companies the same way.

## Use

```tsx
<Avatar name="Ada Lovelace" id="person_1" />
<Avatar name="Northwind" shape="square" hue="ink" size="lg" />
<AvatarStack people={viewers} max={3} />
```

- People are circles, companies and other records squares (`shape`).
- `size`: `xs` 16px, `sm` 20px (the default), `md` 24px, `lg` 32px, `title` 48px (a record heading its page or panel, beside its name), `xl` 72px (a booking page's host).
- `hue` comes from the display shape when it names one; otherwise a stable hash of `id` picks one of the nine, so a person keeps their colour.
- `src` loads only from our origin, `data:image` or `blob:` (`safeImageSrc`, AC-14); anything else, or a broken picture, shows the initials.
- `isDecorative` hides it from screen readers when the name is written beside it (chips do this). Otherwise it reads as an image named after the person.
- `AvatarStack` shows `max` avatars and "+N", and names everyone in it for screen readers.
- `total` counts people the stack stands for but wasn't given (a public team page sends only 4 faces and how many more), so "+N" counts them too. `label` replaces the names as the stack's accessible name ("Team of 6") where names aren't for reading out.

## States

Picture, initials, a picture that failed (initials). A stack: names read out, or its `label` with "+N" counting `total` (a team page).

## Keyboard

It takes no focus.

## Differences from the artifact

- `size` is a named step, not a number; `hue` replaces `color`, and `id` seeds the hue.
- `isDecorative` replaces `decorative`. Outside pictures are refused until #32 serves them through our origin.
