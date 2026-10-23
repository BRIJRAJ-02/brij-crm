# LinkList

Links as rows, not a table: a short list of links beside other work, such as Bookings › Availability's "Your pages" inside a Card (`density="compact" placement="card"`).

Since 20 October 2026, Captures › Links and Forms draw LinkGrid's cards instead. The owner turned down the compact rows there: on a full width page the title and facts sat far apart, and the end controls were too close together to hit.

## Why it exists

New in spec 0025. Table is a grid of cells with a header and column alignment, which reads wrong for a handful of links with varying facts, and a variant would fight its keyboard model (Table moves by cell).

On 19 October 2026 the owner asked for Links and Forms to look the same, since a form is a link too. Forms drew Cards; LinkList was extended to hold them rather than a new CaptureList made, because a form's row has the same parts (title, address, facts, on or off, actions) and this README always meant forms' links to join it. The row follows the Cal.com event types list: about 60px tall, the whole row opens it (a React Aria `GridList`, with `data-pressable`), the title in the text colour with its address inline and muted, chips under them, and at the end a grey badge when it is off, its switch, and one joined group of icon buttons. A search field and the list's action sit above.

## Rows as links

`rowsAreLinks` draws each row as a plain link to its `href` (a list of `a` elements) instead of a GridList row: for a public page whose visitors open rows in a new tab or copy their address, and whose crawlers follow them. A profile's booking links use it (BookingProfile, 22 October 2026). Such rows carry no switch or actions and take no `onOpen`; Tab moves from link to link.

## Rows that move

`onMove` with `rowOrder` makes the rows movable (owner ask A102, 23 October 2026): Settings › Profile arranges the Public booking pages a person's profile lists, a compact list in a Card per section. Why a variant and not a new list: the rows are the same rows (title, facts, the Paused badge, the row menu, opening the page), only their order changes, and the library's sortable rows (Table, QuestionList) each draw their own row look.

- A grip starts each row, in a cell of the handle's width, so the titles line up; space-8 from the title. A row alone in its list (nowhere to go) and a pending row keep the cell and have no grip.
- Drag a grip, or press Enter or Space on it, then the arrow keys and Enter or Space again (Escape puts it back). The others slide out of the way, the row being moved is lifted (`surface-raised`, `shadow-md`, an outline in forced colours), each step is said ("Intro call, moved to position 2 of 3."), and focus comes back to the grip. A drop calls `onMove(id, toIndex)` with the row's new index among `rows`.
- While the search narrows the rows the grips go away: a narrowed list can't say where a row lands among the ones it hides. `rowsAreLinks` never moves.
- In a narrow card the grip stays beside both lines of a row that takes a second one.
- The drag wrapper (dnd-kit) comes in from the screen: `rowOrder={LinkListRowOrder}` beside `onMove`, from `@crm/ui`. LinkList never imports it, so a public profile's links (`@crm/ui/public-booking`), which never move, never load dnd-kit. Why not a lazy import: it was one on 23 October 2026, and its chunk split the shared files every page loads first (41, past the build's 40, and 1.4 kB more gzipped on the app, the hosted form and the booking page). Without `rowOrder` the rows hold still, `onMove` or not. While the rows load, their skeleton rows keep the grips' places too.
- Give each row a menu with Move up and Move down too (`actions`): the single pointer way (WCAG 2.5.7), and the one a screen announces itself.

```tsx
import { LinkList, LinkListRowOrder } from '@crm/ui';

<LinkList
  density="compact"
  placement="card"
  isToolbarHidden
  label="Pages under Sales"
  searchLabel="Pages under Sales"
  rows={rows} // in the order they move in, each with its Move up and Move down menu in `actions`
  onOpen={open}
  onMove={(id, toIndex) => move(id, toIndex)}
  rowOrder={LinkListRowOrder}
/>
```

## Density

On 20 October 2026 the owner asked for the Captures screens, ported from timefix, to be built on our own design system: the records area's look, not Cal.com's event types cards. So LinkList has two densities.

- `density="compact"`: the records area's rows. One line at size-row (34px), no frame and no raised box, rows parted by the grid's hairline (`border-subtle`). Each row is the title with its address inline and muted, then the facts (`chips`) as one cell of muted text ("30 min · 60 min"), then the badge, the switch and the actions. Facts are text and states are Badges, so a count never reads as a state. An off row carries no Off badge in compact: its muted title and its switch say it (owner, 20 October 2026), so `badge` is for what they can't ("Not published", "Private", "Copying…"). The cells sit on a subgrid, so the facts and the ends line up down the list. `description` isn't shown. Under 480px of list, the facts and the address give way, so the title, switch and actions stay on one line. Captures › Links and Forms use it.
- `density="comfortable"` (the default): rows about 60px tall in a raised, bordered box, with the description and the chips under the title.

`placement` says where a compact list sits:

- `placement="page"` (the default): edge to edge across the view, with the page's 16px gutter inside each row, so hover and the dividers run the full width (Captures, under its tab strip, with no PageColumn around it).
- `placement="card"`: inside a Card's padding, rows inset 8px like a Table's cells, and no hairline under the last row (the card's edge closes it). Under 480px of list a row takes more lines rather than hiding anything: the address wraps under the title and the facts sit under it, with the end beside them.

The references (Mobbin, 20 October 2026): Attio's record lists gave the edge to edge one line rows, the hairlines and the facts lined up in a column; Notion's settings rows and Klaviyo's list gave the switch and the quiet menu at the row's end on one line; Stripe's invoice rows gave the status badge inline before the actions, with the plain facts beside it as text. Cal.com's event types and Calendly's cards are the framed, two and three line rows `comfortable` keeps, which `compact` moves away from.

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

A compact row has no second line, so PagesHours puts the hours ("Mon to Fri, 9:00 AM to 5:00 PM") in `address`, the muted text after the title, since the hours are what that list is for. In a card nothing is hidden on a phone: the hours wrap under the title, the badges under them.

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
- `status`: `loading` (the search row, then three skeleton rows in the rows' shape, after the loading delay), `error` (the search row stays, so New still works, then an EmptyState with Try again from `onRetry`, titled `errorTitle`; compact with `placement="card"` draws it as one row, as a card's other sections do, and a block everywhere else) or `no-access`.
- A page that draws the search and action elsewhere passes `isToolbarHidden`, holds the search in `query` and `onQueryChange`, and draws `LinkListToolbar` where it wants them. Captures puts it at the end of its Links · Forms strip (Tabs' `end`, the owner's call on 20 October 2026), at `size="sm"`.
- `titleBadge` puts a Badge right after a row's title, for what the row is rather than a state that comes and goes: Bookings › Availability's schedules mark the default one "Default" beside its name (owner, 22 October 2026: the badge sat far right, away from the name it describes). Why a prop and not `badge`: `badge` is the end's state (Not published, Copying…), lined up with the switch; this one belongs to the name. Bookings › Availability draws its schedules as a compact, page placed list: name and Default, the week inline, the zone and how many pages use it as the facts, the row opening the schedule and its menu at the end.
- A short list beside other work leaves the search out the same way (`isToolbarHidden`, with no `LinkListToolbar` anywhere) and can leave out each row's `actions` and `toggle`: the row itself opens. Bookings › Availability lists the member's pages with the hours each books on like this, inside a Card.
- A row's `href` says where opening it goes. `onOpen` still opens it; the row carries `data-href`, so the app loads that page while a pointer rests on the row (a pending row carries none).
- `emptyState` shows with no rows at all, with no search. A screen whose list is empty draws its EmptyState in a centred PageColumn (`align="center"`), with the New button in it.

## States

Both densities: rows, off (badge and switch), not published (badge, switch disabled), pending, searched and no matches, loading (skeleton rows), failed (Try again), no access, empty (the caller's EmptyState). Hover on a row (pointer only), focus (the inset ring); the controls' own hover, focus and pressed states. With `onMove`: grips (the skeleton rows keep their place too), a row lifted while it moves, and no grips while a search narrows the rows.

## Keyboard

Tab reaches the search field, the list's action, then the list on a row. The up and down arrows move between rows, Enter opens the focused one, and left and right move between a row's controls (the grip, the switch, Open, Copy link, the menu). Tab leaves the list. On a grip, Enter or Space lifts the row, the arrows move it, Enter or Space drops it and Escape puts it back.

## Differences from the artifact

Not in the artifact yet. `density` and `placement` are new (20 October 2026), `onMove` too (23 October 2026). Spec 0025's `tag` gave way to `badge` and `toggle`, the title is no longer a Button, `searchLabel` and `actions` are new, and the actions are ghost icon Buttons with no frame (20 October 2026).
