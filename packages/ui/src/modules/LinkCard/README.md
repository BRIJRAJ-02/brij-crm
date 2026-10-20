# LinkCard

One link as a card: a booking page in Captures › Links, a form in Captures › Forms (spec 0025, spec 0023). LinkGrid lays them out; a card also stands alone.

## Why it exists

New on 20 October 2026. The owner turned down the one line rows Captures had drawn with LinkList's compact density ("don't like this design"): on a full width page the title and its facts sat a long way apart, and the switch and three small icon buttons were crammed at the far end, "too close, and will be missed". The owner picked a card grid after Calendly's event types instead.

Card was the closest component, but it doesn't fit, and a variant would bend it out of shape:

- Card's title is plain text. Here the title is the card's one link, stretched over the whole card.
- Card has no colour edge.
- Card's footer is end aligned. Here Copy link sits at the start and the actions at the end.

LinkCard takes Card's look (hairline border-subtle, radius-lg, surface-raised, shadow-xs, a footer on surface-subtle over a hairline) so the two read as one family.

References (Mobbin, 20 October 2026):

- Calendly's event types gave the colour edge on the start side, the title over its facts, and a real "Copy link" button beside a quiet open icon and the ··· menu.
- Calendly's turned off cards, greyed rather than badged, gave the quiet off state.
- Cal.com's and SavvyCal's link lists gave the switch at the top end.

## Use

```tsx
<LinkCard
  title="Intro call"
  href={pageEditorHref(slug, page.id)}
  hue={hueOf(page.id)}
  facts={['30 min', 'One on one']}
  address="/acme/intro-call"
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

- **`href`:** the editor. The title is the card's one link, and its `::after` covers the card, so a press anywhere opens it. The switch and the footer's controls sit above that link, so each does its own thing. A press on the footer's empty space still opens the card. Left out, or while `isPending`, the card is not a link.
- **`hue`:** the colour edge on the start side, `dot-<hue>`. Forms have no colour, so they leave it out and get the neutral `dot-gray`. Booking pages have no colour field yet, so Captures picks a stable hue from the page's id.
- **`facts`:** one line of muted text under the title, joined with " · " ("30 min · One on one"; "12 responses · 2 spam").
- **`address`:** the public link, muted, truncated to one line.
- **`badge`:** a grey Badge beside the title, for a state the switch can't say ("Not published", "Private", "Copying…"). Never "Off".
- **`isOff`:** the card reads quieter: its title in text-secondary and its edge grey. No badge; the switch says it.
- **`toggle`:** the Switch at the top end, its label hidden (read by screen readers). `isDisabled` with `disabledReason` puts the reason in a tooltip.
- **`copyValue`:** a labelled secondary "Copy link" button at the start of the footer. `copyDisabledReason` disables it and puts the reason in a tooltip ("Publish it first").
- **`actions`:** Open and the ··· menu, ghost icon Buttons at `size="lg"`, at the footer's end in a group named for the card.
- **Footer size:** every footer control is 30px tall (size-input, the library's largest control), and they sit at least space-8 apart.
- **`LinkCardSkeleton`:** the card's shape in skeletons, for a grid that is loading.

## States

Default (live), off, not published (badge, switch and Copy link disabled with the reason), private (badge), pending (quieter, not a link, controls wait), read only (switch disabled with why, no menu), and a long title (two lines, then cut). Hover (fine pointer only) raises the border. Focus on the title rings the whole card. The switch and the buttons have their own hover, focus and pressed states. Nothing moves on press.

## Keyboard

Tab reaches the title link (Enter opens the editor), then the switch, Copy link, Open and the menu. Those controls stay in the tab order in reading order.

## Differences from the artifact

Not in the artifact yet.
