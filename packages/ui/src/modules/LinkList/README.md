# LinkList

Links as rows, not a table: Captures › Links' booking pages and Captures › Forms' forms, one design for both (spec 0025, section 2; spec 0023, the forms list), drawn compact like the records area's rows.

## Why it exists

New in spec 0025. Table is a grid of cells with a header and column alignment, which reads wrong for a handful of links with varying facts, and a variant would fight its keyboard model (Table moves by cell).

On 19 October 2026 the owner asked for Links and Forms to look the same, since a form is a link too. Forms drew Cards; LinkList was extended to hold them rather than a new CaptureList made, because a form's row has the same parts (title, address, facts, on or off, actions) and this README always meant forms' links to join it. The row follows the Cal.com event types list: about 60px tall, the whole row opens it (a React Aria `GridList`, with `data-pressable`), the title in the text colour with its address inline and muted, chips under them, and at the end a grey badge when it is off, its switch, and one joined group of icon buttons. A search field and the list's action sit above.

## Density

On 20 October 2026 the owner asked for the Captures screens, ported from timefix, to be built on our own design system: the records area's look, not Cal.com's event types cards. So LinkList has two densities.

- `density="compact"`: the records area's rows. One line at size-row (34px), no frame and no raised box, rows parted by the grid's hairline (`border-subtle`). Each row is the title with its address inline and muted, then the facts (`chips`) as one inline cell of Badges, then the badge, the switch and the actions. The cells sit on a subgrid, so the facts and the ends line up down the list. `description` isn't shown. Under 480px of list, the facts and the address give way, so the title, switch and actions stay on one line. Captures › Links and Forms use it.
- `density="comfortable"` (the default): rows about 60px tall in a raised, bordered box, with the description and the chips under the title.

`placement` says where a compact list sits:

- `placement="page"` (the default): edge to edge across the view, with the page's 16px gutter inside each row, so hover and the dividers run the full width (Captures, under its tab strip, with no PageColumn around it).
- `placement="card"`: inside a Card's padding, rows inset 8px like a Table's cells, and no hairline under the last row (the card's edge closes it). Narrow, only the facts give way; the address stays and truncates.

The references (Mobbin, 20 October 2026): Attio's record lists gave the edge to edge one line rows, the hairlines and the facts lined up in a column; Notion's settings rows and Klaviyo's list gave the switch and the quiet menu at the row's end on one line; Stripe's invoice rows gave the status badge inline before the actions. Cal.com's event types and Calendly's cards are the framed, two and three line rows `comfortable` keeps, which `compact` moves away from.

### In a Card: Bookings › Availability (PagesHours)

PagesHours draws the compact, card placed variant:

```tsx
<Card title={strings.yourPages} description={strings.yourPagesText}>
  <LinkList
    density="compact"
    placement="card"
    isToolbarHidden
    label={strings.yourPages}
    searchLabel={strings.yourPages}
    rows={rows} // no toggle or actions: the row itself opens
    onOpen={onOpen}
    status={status}
    onRetry={onRetry}
    errorTitle={strings.pagesFailed}
  />
</Card>
```

A compact row has no second line, so PagesHours puts the hours ("Mon to Fri, 9:00 AM to 5:00 PM") in `address`, the muted text after the title, since the hours are what that list is for. In a card the address keeps its room on a phone (the rows have no switch or actions) and truncates; on a page it gives way under 480px.

## Use

```tsx
<LinkList
  density="compact"
  label="Booking pages"
  searchLabel="Search booking pages"
  actions={
    <Button variant="primary" icon="plus">
      New booking page
    </Button>
  }
  rows={[
    {
      id,
      title: 'Intro call',
      address: '/acme/intro-call',
      chips: ['30 min'],
      toggle: { label: 'Intro call is on', isSelected: true, onChange: setOn },
      actions: (
        <>
          <Button icon="external-link" label="Open Intro call in a new tab" onPress={openIt} />
          <CopyButton value={url} label="Copy link to Intro call" isIconOnly />
          <MenuTrigger>…</MenuTrigger>
        </>
      ),
    },
  ]}
  onOpen={(id) => open(id)}
  status={state.status}
  onRetry={retry}
/>
```

- Pressing anywhere on a row, or Enter on it, calls `onOpen` with its id. The controls inside it (the switch, Open, Copy link, the menu) do their own thing and don't open it.
- `address` sits inline after the title, muted (a page's `/<workspace>/<short name>`, a form's `/f/<address>`). `description` adds up to two lines under them (comfortable only).
- `chips` show as neutral Badges with a short label, under the title (comfortable) or in one lined up cell after it (compact): facts, not values, so not the field set's Tag ("30 min"; "12 responses", "2 spam").
- `badge` is a grey Badge before the switch, only when the row isn't taking people ("Off", "Not published"), or "Copying…" on a pending row. Links and forms use the same words.
- `isOff` draws the title in the secondary colour, so an off row reads as off before the switch is read (timefix's links list does the same).
- `toggle` is the row's Switch, its label hidden (read by screen readers): a page's visibility, a form's Accepting. `isDisabled` when it can't be switched, with `disabledReason` in a tooltip on it ("Publish it first").
- `actions` are ghost icon Buttons (a disabled one in a Tooltip saying why), in a group named by the row's title. The owner asked on 20 October 2026 for our own quiet row actions rather than timefix's framed group. A press on a disabled control never opens the row.
- `isPending` draws a row that isn't made yet (a copy on its way) in the tertiary colour; it can't be opened or focused until it lands.
- The search field narrows the rows by title or address as you type, and says when nothing matches, with Clear search. `actions` sit at the other end of its row.
- `status`: `loading` (the search row, then three skeleton rows in the rows' shape, after the loading delay), `error` (the search row stays, so New still works, then an EmptyState with Try again from `onRetry`, titled `errorTitle`) or `no-access`.
- A page that draws the search and action elsewhere passes `isToolbarHidden`, holds the search in `query` and `onQueryChange`, and draws `LinkListToolbar` where it wants them. Captures puts it at the end of its Links · Forms strip (Tabs' `end`, the owner's call on 20 October 2026), at `size="sm"`.
- A short list beside other work leaves the search out the same way (`isToolbarHidden`, with no `LinkListToolbar` anywhere) and can leave out each row's `actions` and `toggle`: the row itself opens. Bookings › Availability lists the member's pages with the hours each books on like this, inside a Card.
- `emptyState` shows with no rows at all, with no search. A screen whose list is empty draws its EmptyState in a centred PageColumn (`align="center"`), with the New button in it.

## States

Both densities: rows, off (badge and switch), not published (badge, switch disabled), pending, searched and no matches, loading (skeleton rows), failed (Try again), no access, empty (the caller's EmptyState). Hover on a row (pointer only), focus (the inset ring); the controls' own hover, focus and pressed states.

## Keyboard

Tab reaches the search field, the list's action, then the list on a row. The up and down arrows move between rows, Enter opens the focused one, and left and right move between a row's controls (the switch, Open, Copy link, the menu). Tab leaves the list.

## Differences from the artifact

Not in the artifact yet. `density` and `placement` are new (20 October 2026). Spec 0025's `tag` gave way to `badge` and `toggle`, the title is no longer a Button, `searchLabel` and `actions` are new, and the actions are ghost icon Buttons with no frame (20 October 2026).
