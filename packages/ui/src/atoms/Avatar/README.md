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
- `size`: `xs` 16px, `sm` 20px (the default), `md` 24px, `lg` 32px, `title` 48px (a record heading its page or panel, beside its name), `xl` 72px (a booking page's host), `hero` 96px (a person's own picture at the top of their link page, where it has a column to itself and is the first thing read; the owner, 26 October 2026). Each diameter and its initials come from the avatar scale in `styles/base.css` (`--avatar-<size>`, `--avatar-initials-<size>`).
- Initials sit at about 40% of the diameter in medium weight: `xs` and `sm` show one initial (8px and 9px), `md` 9.6px, `lg` 12.8px, `title` 19.2px, `xl` 28.8px and `hero` 38.4px show two. The line box is one em tall, which puts Inter's capitals on the optical centre. These sizes are worked out from the diameter on purpose, so the avatar is the one place exempt from the type scale; other text keeps to the `text-*` tokens.
- The tile is a soft tint of its hue (`tag-<hue>-bg`) with the initials in that hue's darker text shade, and no ring (owner, 22 October 2026). Forced colours draw a hairline, since the fill is gone there.
- `hue` comes from the display shape when it names one; otherwise a stable hash of `id` picks one of the nine, so a person keeps their colour.
- While a picture loads, its initials hold the tile at every size, so a company whose site has no icon keeps its letter rather than an empty tile that fills in later (spec 0059). At `title`, `xl` and `hero`, the picture then fades in over its initials, so a page's one big picture never pops (29 October 2026); the smaller sizes swap to it at once, since a fade repeated down a table is noise. The initials go once it has loaded, so a logo with clear parts never shows letters through it, and a picture the browser already holds shows straight away. A loaded picture sits on a near white plate (`on-accent`, the same in both themes, edged with a `border-subtle` hairline) in place of its hue, so a dark logo such as GitHub's still reads in dark mode, where the page's own surface swallowed it (1 November 2026) (spec 0059 follow up, 31 October 2026): a company's favicon is often transparent, and its clear parts on a dark mode hue tile read poorly; the hue and initials stay the fallback, and show while the picture loads.
- `src` loads only from our origin, `data:image` or `blob:` (`safeImageSrc`, AC-14); anything else, or a broken picture, shows the initials. A person's Google account picture reaches it through the api's own origin routes (23 Oct 2026: `bookingPicturePath`, `profilePicturePath` and `myPicturePath` in `@crm/contracts`), never Google's address.
- A company's logo comes the same way (spec 0059): its display's `imageSrc` is `/api/logos/<domain>`, the site's icon fetched by the api. A site with no icon answers 404, and the initials show in the same tile, so nothing moves (the `FailedPicture` story).
- `mark` draws a node (an Icon) in place of the initials, for a face that isn't a person or a record: a form's new submission in the inbox (spec 0023), the system. Use it with `shape="square"` and `hue="gray"`, the soft neutral tile beside people's tints, as RecordChip draws the same actors (its `ACTOR_ICONS`), so a row of people and a form keeps one size and shape. The caller sizes the Icon (`xs` up to the `sm` tile, `sm` at `md`); Avatar takes a node rather than an icon name so it never pulls the icon registry into a page that draws only people (30 October 2026).
- `hue="accent"` draws the initials on the page's accent in `on-accent`: a business page with no logo, whose brand stylesheet sets the accent (5 November 2026). Why a hue: the `ink` tile read as a black square, nothing of the business's own; the accent is the one colour it chose.
- `isEmpty` draws an empty slot waiting for its picture: no fill, a dashed control edge (`control-border`) and `mark` (a "+") in the quiet text colour, at the tile's own size so a row keeps its line; it shows no picture. For a menu item with no photo yet in the editor's Structure, after checklabs' dashed "+" slot (5 November 2026). It stays a tile, not a control: the row it leads opens the item, whose drawer holds the photo picker. Why a variant: a dashed Button in the tile's place was 26px against the rows' 20px tiles and a second tab stop doing what the row does. Story: `Empty`.
- `fit="contain"` keeps the whole picture inside the tile, a hair in from the edge, on a light plate with a hairline (`on-accent`, the same in both themes, so a dark ink logo still reads on a dark sidebar). The plate shows while the picture loads too, empty, so nothing flashes from a dark tile to a light one; a picture that fails shows its letter on the tile's hue. For a workspace's own logo heading the sidebar (spec 0060), which may be a wide wordmark that the default `cover` would crop. Faces and sites' icons keep `cover`. Story: `ContainedLogo`.
- `isDecorative` hides it from screen readers when the name is written beside it (chips do this). Otherwise it reads as an image named after the person.
- `AvatarStack` shows `max` avatars and "+N", and names everyone in it for screen readers.
- `total` counts people the stack stands for but wasn't given (a public team page sends only 4 faces and how many more), so "+N" counts them too. `label` replaces the names as the stack's accessible name ("Team of 6") where names aren't for reading out.

## States

Picture (on the near white plate), initials, a picture still loading (initials on the hue), a picture that failed (initials). A stack: names read out, or its `label` with "+N" counting `total` (a team page).

## Keyboard

It takes no focus.

## Differences from the artifact

- `size` is a named step, not a number; `hue` replaces `color`, and `id` seeds the hue.
- `isDecorative` replaces `decorative`. Outside pictures are refused: a Google account picture and a company's logo come through the api's own origin routes.

A square at `hero` size takes the card corner (`radius-xl`): a link page's rounded face (spec 0060, AC-13).
