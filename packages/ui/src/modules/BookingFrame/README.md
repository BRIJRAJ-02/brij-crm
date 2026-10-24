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

`aside` adds the end pane; leave it off for one wide pane (the details step). `footer` is the band across the card's foot. A fact's `children` may be a control (the time zone's Select). `banner` sits above the card (the visitor's calendar, spec 0028). Without `host` and `title` the rail draws skeletons.

The loading rail is the loaded rail, line for line: the picture at the size the picture will be (`Skeleton shape="circle" size="xl"`), the name and the meeting in their own line boxes (`shape="text"`, which is `1lh` of the font it sits in), the description two rows, and two facts in the rows the length switch and the zone will take. A pane draws whatever it is given, loading or not, so the page hands its own month and its own times, already in their shape, and the card is the right height from the first paint. The heading row keeps a control's height whether or not the toolbar has arrived. Nothing here animates in: the frame is the first thing painted, so it never arrives, it is simply there, and what animates is the content inside it, where something really does arrive (24 October 2026, the owner: "no flash no nothing").

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

Without `person` the card draws as a skeleton, with the picture at the picture's own size and the name and bio in their own line boxes. The links' own rows are the page's to draw: `ProfilePage` passes `LinkList status="loading"` inside `LoadingNow`, so the rows appear at once rather than after the loading delay (a public page's first paint is already its loading state, so there is no content for a skeleton to flash in front of). The frame deliberately does not draw them itself: LinkList in this module would put it in the booking page's first load, which is 19 kB it has no room for, so `<BookingProfile />` on its own is the card alone, which is what the fallback for the profile's module draws while that chunk arrives. Its foot's links are tagged as the profile's (`booking_profile`), and a message on a profile passes `page="booking_profile"` to BookingMessage.

The profile's column starts at the top rather than centring, unlike the booking page's: a list whose length nobody knows until it arrives would otherwise pull the person's own card up the page as the rows filled in.

### BookingHandleOffer (25 October 2026)

A `/<handle>` nobody holds. Today the page said "Page not found. No one has this address." and stopped; the owner pointed at Cal.com's version of the same page, which tells the visitor the name is still free and offers it, and asked for that in our clothes. So, in order: the quiet fact ("Page not found") as a small label, then the headline with the address itself as its subject and the accent on what is on offer ("timefix.com/ada **is free**"), then one bordered card holding a line and the action, whose button quotes the address back ("Sign up and take /ada"), then the foot. The button names signing up rather than claiming, because that is all it can do today: nothing on the other side reads the address yet, so "Claim" would promise what the next screen doesn't do. Past 18 characters the button says "Sign up and take this address", since a 40 character handle pushes it off a phone and the headline above carries the address whole anyway.

```tsx
<BookingHandleOffer address="timefix.com/ada" handle="ada" claimHref={signInPath({ handle: 'ada', appOrigin })} />
```

What it deliberately leaves out: Cal's list of other places to go (documentation, a blog), since a stranger has nowhere useful to be sent and a row of weak links under a strong offer is what `subtractive-design` cuts; and the foot's claim link, since the card already is the claim, so the foot carries the wordmark alone.

Only an address nobody holds reaches this page. A word kept for Timefix (`RESERVED_HANDLES`) and a handle somebody holds, whether or not anything of theirs is public, both keep BookingMessage's plain not found, so the page can never say that a private account sits behind an address. The page decides that from one closed answer, `free` or `absent` (`readHandleOffer` in core, `GET /api/public/profiles/:handle/offer`).

Why these few classes rather than props on BookingMessage: it is the same ground, column, card and foot, which live in this folder, as BookingProfile is. But BookingMessage is one card with a heading inside it, and this page's heading stands above its card, which is what makes the card read as the one thing to press; the three props it would take (a lead line, an accent word, a link action) would make it two components in one. The headline takes the note title's size, one step above a heading, because here the offer is the whole page.

## States

Three panes, two panes, a personal page with the host's picture (initials if it fails), a team page, loading; BookingMessage's loading (the heading's and the line's places, and no picture, since a message never has one), message and Try again; BookingProfile's loaded, with sections (a row with no address shows none), empty, and loading; BookingHandleOffer's offer, and the longest address a handle can make, which breaks rather than running off a phone and shortens its button's words.

## Keyboard

None of its own. BookingMessage and BookingHandleOffer each focus their heading as they show, so a visitor who lands on one is read the offer before the action.

## Differences from the artifact

Not in the artifact.
