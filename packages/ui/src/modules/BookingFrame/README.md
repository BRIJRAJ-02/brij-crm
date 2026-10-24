# BookingFrame

A booking page's frame (spec 0025, 0025-experience.md; laid out as the timefix booking page, the owner's call on 20 October 2026): the host in a rail of their own (a large picture, the name, the meeting as the page's `h1`, its facts, and a "Powered by Timefix" card pinned at the rail's foot), beside one card: a heading row with Month or List, the month and the day's times side by side (the times scroll inside their pane at the month's height), and a band across the foot for the Book bar. Under the page breakpoint everything stacks and Timefix moves to the page's end, centred. This folder also holds `BookingFoot` (that foot alone, for the guest's booking page) and `BookingMessage` (one small card for a page with nothing to book: loading, not found, paused, or failed with Try again).

## Why it exists

New. The public booking page moved onto the library on 20 October 2026 (as the hosted form did), and no layout held a rail beside a card of two panes. PageColumn and PreviewLayout are app pages inside the shell; AuthLayout is one narrow card.

## Use

```tsx
<BookingFrame
  host={{ name: 'Ada Lovelace' }}
  title="Intro call · 30 min"
  facts={[{ id: 'where', icon: 'video', children: 'Video call' }]}
  heading="Choose a time"
  toolbar={<SegmentedControl … />}
  aside={<SlotList … />}
  footer={<Button variant="primary" size="lg" isFullWidth="center">Book</Button>}
  claimHref={claimPageHref('booking_page')}
>
  <MonthTiles … />
</BookingFrame>
```

The foot's two links go to www.timefix.com with the campaign tags from `@crm/contracts/brand`, the one place the hosted form and the emails take theirs from: the wordmark tags itself (`poweredByHref` with the foot's `page`, the booking page unless BookingProfile, BookingMessage or BookingReceipt's own foot says otherwise), and `claimHref` comes from `claimPageHref` for the same page.

`aside` adds the end pane; leave it off for one wide pane (the details step). `footer` is the band across the card's foot. A fact's `children` may be a control (the time zone's Select). `banner` sits above the card (the visitor's calendar, spec 0028). Without `host` and `title` the frame draws skeletons.

A team page (spec 0037, AC-1339) passes `host.team`: up to 4 faces stack in place of the large picture, with "+N" for the rest and the stack named by `label` ("Team of 6"); the host's name line is left out, since the page passes the title as "Intro call with Acme". A personal page leaves `team` off and draws exactly as before; its `host.image` is the host's picture from our own origin (the page's `hostImage`, 23 Oct 2026), and the initials show without one or when it fails.

### BookingProfile (22 October 2026)

A person's public profile, `/<handle>`, the Cal.com profile the owner pointed at: one card with their picture, their name as the page's `h1` and a one line bio, then their booking links, then the foot. `BookingProfileSection` groups links under the small heading their owner gave them. The links themselves are LinkList's comfortable rows (the whole row opens the page), with LinkListToolbar above them once there are many.

Why a variant here rather than a new module: it is the booking pages' own page, so it keeps their background, centred column, card and foot, which live in this folder. The column is wider than BookingMessage's so a row's title and chips fit.

```tsx
<BookingProfile person={{ name: 'Ada Lovelace', id: 'ada', bio: 'Product at Acme.' }} claimHref={claimPageHref('booking_profile')}>
  <BookingProfileSection title="Sales">
    <LinkList label="Sales" searchLabel="Search" isToolbarHidden rows={rows} onOpen={open} />
  </BookingProfileSection>
</BookingProfile>
```

Without `person` the card draws as a skeleton. Its foot's links are tagged as the profile's (`booking_profile`), and a message on a profile passes `page="booking_profile"` to BookingMessage.

## States

Three panes, two panes, a personal page with the host's picture (initials if it fails), a team page, loading; BookingMessage's loading, message and Try again; BookingProfile's loaded, with sections (a row with no address shows none), empty, and loading.

## Keyboard

None of its own. BookingMessage focuses its heading as it shows.

## Differences from the artifact

Not in the artifact.
