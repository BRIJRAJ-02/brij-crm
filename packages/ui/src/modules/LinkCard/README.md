# LinkCard

One link as a card: a booking page in Captures › Links, a form in Captures › Forms (spec 0025, spec 0023). LinkGrid lays them out; a card also stands alone.

## Why it exists

New on 20 October 2026. The owner turned down the one line rows Captures had drawn with LinkList's compact density ("don't like this design"): on a full width page the title and its facts sat a long way apart, and the switch and three small icon buttons were crammed at the far end, "too close, and will be missed". The owner picked a card grid after Calendly's event types instead.

Card was the closest component, but it doesn't fit, and a variant would bend it out of shape:

- Card's title is plain text. Here the title is the card's one link, stretched over the whole card.
- Card has no colour mark.
- Card's footer is end aligned. Here Copy link sits at the start and the actions at the end.

LinkCard takes Card's look (hairline border-subtle, radius-lg, surface-raised, shadow-xs) so the two read as one family.

On 21 October 2026 the owner asked for the form card to "look better". Three things made it read worse than it is:

- The footer sat on its own tinted band over a hairline, so the card read as two boxes, and in dark mode the band was darker than the card. The footer now sits on the card's own surface: one surface, the same controls.
- A form's edge was grey, which read as switched off next to the coloured booking pages. A form now takes a stable colour from its id, as a booking page does.
- A form never published showed a disabled switch and the address it would get. It now shows neither: its badge and its one fact say what to do.

On 4 November 2026 the owner's team said the cards "look like AI". The thick colour stripe on the start side was the tell. It is gone:

- A link with a colour (a booking page) shows it as a small dot before its title; a form has none.
- The public link moved into the footer, at its start, beside Copy link: one line fewer, and the link sits where it is copied from.
- The padding is even on both sides now that no stripe needs room.

On 5 November 2026 the owner asked again, of the forms list: "Can we make these cards look much prettier", and then "looks AI generated bland". Every card was the same three lines of grey text over a row of outlined buttons. A card can now carry a picture of what it opens:

- `picture` draws it on a stage across the card's top: a sheet the width of half a panel on surface-subtle, cut at the stage's foot (until spec 0072 the stage was tinted with the link's colour and the sheet lifted on hover). A form's card draws its own form there (`HostedFormPreview size="thumbnail"`: its headline and first questions, in its own Light or Dark), so the cards stop looking alike; a booking page's card draws its month (`BookingPagePicture`).
- `status` puts the state first on the facts line as a dot and a word ("Live", "Draft", "Paused"), in place of a badge mixing states with news.
- Later that day, the owner pointing at the booking cards: "make something like this for forms as well". A form's card now draws `FormPicture` (its name, count and first questions as shapes, in a colour from its id) in place of the literal `HostedFormPreview`, its submissions count moved to the facts line's end (`factsEnd`), and its foot holds its address, Copy, Open and ⋯ as a booking card's does.
- `lead` gives the footer's start to one control of the card's own (a form's "24 submissions", a draft's Edit), and `isCopyQuiet` makes Copy link a ghost icon with a tooltip, so the foot holds one word link and two quiet icons instead of three outlined buttons.

Why a variant and not a new card: the link over the whole card, the switch, the footer and the states are all LinkCard's, and the booking pages list wears the same picture.

References (Mobbin, 5 November 2026): Flodesk's forms grid (screen 8fa09a9c-094f-4371-9bd3-fa1c4ef0b7d4) gave the picture of the form itself on a tinted stage over a quiet name and count; Jira's forms (f19dd390-f093-459e-b969-53aff80b390a) the same layout with a generic sheet, which is what the real form replaces; Aboard's forms list (513eca59-3661-4831-97b3-a35b2d7e6632) the counts as quiet words, not buttons; Tally's list (39fe800c-a785-43d8-be2c-0379f9ba4211) "Draft" and the count as one quiet word each.

References (Mobbin, 20 October 2026):

- Calendly's event types gave the title over its facts, and a real "Copy link" button beside a quiet open icon and the ··· menu.
- Calendly's turned off cards, greyed rather than badged, gave the quiet off state.
- Cal.com's and SavvyCal's link lists gave the switch at the top end.

## Use

```tsx
<LinkCard
  title="Intro call"
  href={pageEditorHref(slug, page.id)}
  colourKey={page.id}
  titleLevel={2}
  facts={['30 or 60 min', 'One on one']}
  address="/b/k3x9"
  badge={page.isPrivate ? 'Private' : undefined}
  isOff={page.status === 'paused'}
  toggle={{ label: 'Intro call is on', isSelected, onChange }}
  copyValue={publicUrl}
  actions={
    <>
      <Tooltip content="Open in a new tab">
        <Button variant="ghost" size="lg" icon="external-link" label="Open Intro call in a new tab" onPress={openIt} />
      </Tooltip>
      <MenuTrigger>
        <Button variant="ghost" size="lg" icon="ellipsis" label="More for Intro call" />
        <Menu …/>
      </MenuTrigger>
    </>
  }
/>
```

- **`href`:** the editor. The title is the card's one link, and its `::after` covers the card, so a press on the card's body opens it.
  - The switch sits in a 32px box above that link, and the footer and the address sit above it too. So a press that just misses a control does nothing, rather than opening the editor ("too close, and will be missed").
  - Left out, or while `isPending`, the card is not a link.
- **`hue` or `colourKey`:** a small `dot-<hue>` dot before the title.
  - `colourKey` (a booking page's id) picks a stable hue for a link with no colour of its own, leaving out grey and red.
  - Left out (both), no dot (a form).
  - The dot never says a state: an off card keeps its colour.
- **`titleLevel`:** 2 on a page whose h1 is the TopBar (LinkGrid passes it), 3 inside a section (the default).
- **`facts`:** one line of muted text under the title, joined with " · " ("30 min · One on one"; "12 submissions · 2 spam"; "No submissions yet").
- **`address`:** the public link as a path, muted, at the footer's start, truncated first when the card is narrow ("/b/k3x9", "/f/contact-us"). It can be selected, and Copy link selects it when the clipboard refuses. Leave it out while there is no link (a form never published).
- **`badge`:** a grey Badge beside the title, for a state the switch can't say ("Not published", "Private", "Copying…"). Never "Off".
- **`isOff`:** the card reads quieter, its title in text-secondary and its picture without colour. No badge: the switch says it.
- **`toggle`:** the Switch at the top end, its label hidden (read by screen readers). `hint` says what it does now in a tooltip on hover ("Taking bookings", "Accepting submissions"); `isDisabled` with `disabledReason` puts the reason there instead. Leave it out when there is nothing to switch yet (a form never published), rather than a disabled switch.
- **`copyValue`:** a labelled secondary "Copy link" button in the footer, after the link. Leave it out when there is nothing to copy (a form not published yet), rather than showing a disabled button whose reason can't be reached.
- **`picture`:** what the link opens, small, on a stage across the card's top (a form's `FormPicture`, a booking page's `BookingPagePicture`). It is hidden from assistive tech and inert, and the title's link lies over it, so a press on it opens the card. It holds still under the pointer (the card's edge and shadow answer instead); off, it fades to `opacity-disabled` in grey. `LinkCardSkeleton hasPicture` (LinkGrid's `hasPictures`) draws the stage while the grid loads, so nothing jumps.
- **`status`:** the state as a StatusDot at the facts line's start, a middle dot after it ("● Live · edited 2 minutes ago").
- **`lead`:** the footer's start in the address's place: one ghost control of the card's own, its icon lined up with the title.
- **`factsEnd`:** the facts line's end, after a middle dot: one quiet control of the card's own, raised above the card's link (a form's "12 submissions" as a quiet Link, with New beside it), so the foot keeps the address, Copy, Open and ⋯ as a booking card's does (5 November 2026).
- **`isCopyQuiet`:** Copy link as a ghost icon, named "Copy link" with a tooltip, for a card whose foot already has a word link.
- **`variant="page"`** (Bookings › Pages, the owner's mock of 9 November 2026): a head with the kind's `icon` on a quiet tile (`size-control`, `surface-subtle`, a hairline), the title (one line, still the link over the whole card, so the whole card opens the editor) with one `badge` at most and `actions` (the ⋯) at its end; an inset of the `facts` (`text-body-sm`, `text-secondary`), who it books with (`people`: an AvatarStack, at most four faces, and its words, which also name the stack) and the `address` once; then a foot on the card's own surface (the prototype's card foot, spec 0072; it was a band on `surface-subtle`) with a labelled Copy link at its start and `footEnd` (the page's Live or Hidden menu) at its end. `isOff` quietens the title to `text-secondary` (by colour, not opacity, so every word keeps its contrast). `toggle`, `picture`, `status`, `lead` and `factsEnd` are the default card's. `LinkCardSkeleton variant="page"` is its loading shape. Why a variant and not a new card: the link over the card, Copy link, the states and the grid are LinkCard's; the mock moves the controls and adds the faces. Stories: `PageVariant`, `PageHidden`, `PageLoading`.
- **`actions`:** Open and the ··· menu, ghost icon Buttons at `size="lg"`, at the footer's end. Leave Open out when the link is off.
- **The footer group:** the whole footer is a group named for the card ("Actions for Intro call"), so each card's "Copy link" is told apart. It sits on the card's own surface, with no band.
- **Footer size:** every footer control is drawn at 30px (Button `lg`) and pressed at 32px, and they sit at least space-8 apart.
- **The switch:** pressed at 32 by 34 with its label hidden, inside a 32px box above the card's link.
- **`LinkCardSkeleton`:** the card's shape in skeletons, for a grid that is loading.

## States

**States:**

- default (live);
- off (no Open);
- not published (badge, no switch, no address, no Copy link or Open);
- private (badge);
- pending (quieter, not a link, controls wait);
- read only (switch disabled with why, no menu);
- a long title (one line, then cut, as the prototype's cards do).
- pictured (a stage across the top, a status dot, a lead link, a quiet Copy link), and its loading shape.

**Hover:** fine pointer only; the edge turns `border` and the card takes `shadow-xs`.

**Focus:** focus on the title rings the whole card with the outline ring, which forced colours keep as it is.

The switch and the buttons have their own hover, focus and pressed states. Nothing moves on press.

## Keyboard

Tab reaches the title link (Enter opens the editor), then the switch, Copy link, Open and the menu. Those controls stay in the tab order in reading order.

## Differences from the artifact

Not in the artifact yet.

## Timefix prototype (spec 0072)

Takes its look from the prototype's LinkList family, as its management cards draw it: the booking pages' BookingPageCard and the forms' FormCard (the prototype's LinkList folds LinkCard; its own LinkCard is a link page's featured card, which LinkPage draws). A `surface` card with a `border-subtle` hairline, `radius-lg` and no shadow at rest; under a fine pointer over its link (which covers the card) the edge turns `border` and the card takes `shadow-xs`, over `duration-quick` on `ease-out`; the keyboard's focus on the title rings the whole card with the outline ring (`border-width-focus` solid `focus-ring`, `space-2` out). The body is padded `space-12` `space-16` `space-8`, the title `text-body-strong` on one line, the facts `text-body-sm` in `text-secondary`, `space-2` under it; the foot is padded `space-8` `space-12` `space-12` `space-16`. A picture's stage is `surface-subtle`, `calc(3 * size-control-lg + space-4)` tall, over a `border-subtle` hairline; its sheet is `surface` with `shadow-xs` and `radius-md` top corners; an off card's picture fades to `opacity-disabled` and greys over `duration-fast` on `ease-smooth-out`. The `page` variant's foot sits on the card's surface as the prototype's card foot does, its facts `text-body-sm` in `text-secondary`. Nothing moves on press.

**Use it for** a booking page or a form on its list (Captures › Links and Forms, Bookings › Pages), alone or in LinkGrid. **Don't use it for** a link page's featured link (LinkPage) or a short list in a card (LinkList).

**The consumer provides** `title`, `href`, `hue` or `colourKey`, `titleLevel`, `facts`, `address`, `badge`, `isOff`, `isPending`, `toggle`, `copyValue`, `isCopyQuiet`, `actions`, `picture`, `status`, `lead`, `factsEnd`, and for `variant="page"` `icon`, `people` and `footEnd`.

**States**: rest, hover (`Hovered`), keyboard focus (`Focused`), off, not published, private, pending, read only, a long title, pictured, loading, the page variant's live, hidden, pending, loading and view only, and a refused address drawn as plain text (`RefusedHref`, AC-12).

**Differences from the prototype**
- The prototype's FormCard draws its picture inset in the card on `canvas` and its status as a Tag beside a rolling count; the library keeps one card for pages and forms, its stage across the top, the status as a StatusDot on the facts line and its counts as the caller words them (`factsEnd`). A rolling count (NumberRoll) is owed to the forms screen phase.
- No press ease to .99 (the house rule: nothing scales on press). No Copied text morph or icon swap on Copy link: that is CopyButton's.
- Kept beyond the prototype: `toggle` with its hint, `badge`, `address`, `lead`, `factsEnd`, `isCopyQuiet`, pending and read only, the `page` variant and `LinkCardSkeleton`.
- Rules it repeats from LinkList's module (decision 14, no reach across folders): the `surface` ground, the `border-subtle` hairline and `radius-lg`, and the outline ring; they leave with whichever export goes first.
- Until spec 0072 the stage was tinted with the link's colour, the sheet lifted `space-4` on hover, the card had `shadow-xs` at rest and the title wrapped to two lines; the prototype draws none of these, so they went (about 120 B of CSS gzipped).
