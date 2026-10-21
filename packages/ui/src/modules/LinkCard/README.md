# LinkCard

One link as a card: a booking page in Captures › Links, a form in Captures › Forms (spec 0025, spec 0023). LinkGrid lays them out; a card also stands alone.

## Why it exists

New on 20 October 2026. The owner turned down the one line rows Captures had drawn with LinkList's compact density ("don't like this design"): on a full width page the title and its facts sat a long way apart, and the switch and three small icon buttons were crammed at the far end, "too close, and will be missed". The owner picked a card grid after Calendly's event types instead.

Card was the closest component, but it doesn't fit, and a variant would bend it out of shape:

- Card's title is plain text. Here the title is the card's one link, stretched over the whole card.
- Card has no colour edge.
- Card's footer is end aligned. Here Copy link sits at the start and the actions at the end.

LinkCard takes Card's look (hairline border-subtle, radius-lg, surface-raised, shadow-xs) so the two read as one family.

On 21 October 2026 the owner asked for the form card to "look better". Three things made it read worse than it is:

- The footer sat on its own tinted band over a hairline, so the card read as two boxes, and in dark mode the band was darker than the card. The footer now sits on the card's own surface: one surface, the same controls.
- A form's edge was grey, which read as switched off next to the coloured booking pages. A form now takes a stable colour from its id, as a booking page does.
- A form never published showed a disabled switch and the address it would get. It now shows neither: its badge and its one fact say what to do.

References (Mobbin, 20 October 2026):

- Calendly's event types gave the colour edge on the start side, the title over its facts, and a real "Copy link" button beside a quiet open icon and the ··· menu.
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
- **`hue` or `colourKey`:** the colour edge on the start side, `dot-<hue>`.
  - `colourKey` (a booking page's or a form's id) picks a stable hue for a link with no colour of its own, leaving out grey and red. Neither has a colour field yet.
  - Left out (both), the edge is the neutral `dot-gray`.
  - The edge never says a state: an off card keeps its colour.
- **`titleLevel`:** 2 on a page whose h1 is the TopBar (LinkGrid passes it), 3 inside a section (the default).
- **`facts`:** one line of muted text under the title, joined with " · " ("30 min · One on one"; "12 submissions · 2 spam"; "No submissions yet").
- **`address`:** the public link as a path, muted, truncated to one line ("/b/k3x9", "/f/contact-us"). It can be selected, and Copy link selects it when the clipboard refuses. Leave it out while there is no link (a form never published).
- **`badge`:** a grey Badge beside the title, for a state the switch can't say ("Not published", "Private", "Copying…"). Never "Off".
- **`isOff`:** the card reads quieter, its title in text-secondary. No badge: the switch says it.
- **`toggle`:** the Switch at the top end, its label hidden (read by screen readers). `hint` says what it does now in a tooltip on hover ("Taking bookings", "Accepting submissions"); `isDisabled` with `disabledReason` puts the reason there instead. Leave it out when there is nothing to switch yet (a form never published), rather than a disabled switch.
- **`copyValue`:** a labelled secondary "Copy link" button at the start of the footer. Leave it out when there is nothing to copy (a form not published yet), rather than showing a disabled button whose reason can't be reached.
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
- a long title (two lines, then cut).

**Hover:** fine pointer only; it raises the border.

**Focus:** focus on the title rings the whole card in accent-line. In forced colours the title draws a Highlight outline.

The switch and the buttons have their own hover, focus and pressed states. Nothing moves on press.

## Keyboard

Tab reaches the title link (Enter opens the editor), then the switch, Copy link, Open and the menu. Those controls stay in the tab order in reading order.

## Differences from the artifact

Not in the artifact yet.
