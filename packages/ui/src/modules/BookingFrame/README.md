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

`aside` adds the end pane; leave it off for one wide pane (the details step). Under the page breakpoint the end pane stacks under the first in a box of its own, eight rows tall, where the times scroll: the card is then the same height whichever day is open.

`cover` draws another view of the times (List, Book by chat) over the month, in exactly the box the panes and the footer take, with `coverFooter` as its own Book bar band (25 October 2026, the owner: switching views "must not move ANYTHING"). The month stays underneath, hidden and `inert`, so it still sets the card's size and no view can move the page, whichever one it opens on. A cover lays its parts top down, and a last part that doesn't grow sits at the foot (the chat's composer, or its place while it loads). `view` names what the card shows; when it changes after the first paint the month fades out in `--duration-exit` and the new view fades in over `--duration-move`, opacity only, so reduced motion keeps it. The first paint never fades. `coverPlace="card"` takes the whole card, the heading row too: the details step draws there, so the step never changes the card's size. `enter` says which way a step went: `forward` slides the cover in from the end, `back` slides the month in from the start (Back, or a time someone just took), both over `--duration-move`, and reduced motion keeps the fade alone. `footer` is the band across the card's foot. A fact's `children` may be a control (the time zone's Select). `banner` sits above the card (the visitor's calendar, spec 0028). Without `host` and `title` the rail draws skeletons.

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

## States

Three panes, two panes, List over the month (`SwitchingViews`), the details step over the card and Back (`StepToDetailsAndBack`), the same from the keyboard (`FromTheKeyboard`), a page loading on chat (`ChatLoadingOverMonth`), a personal page with the host's picture (initials if it fails), a team page, loading; BookingMessage's loading (the heading's and the line's places, and no picture, since a message never has one), message and Try again; BookingProfile's loaded, with sections (a row with no address shows none), empty, and loading.

## Keyboard

None of its own. A view or a step chosen from the keyboard (the view switch's arrows, Enter on Book or Back) shows at once, with no fade or slide, decided as it changes, so focus moving on later never replays one. BookingMessage focuses its heading as it shows.

## Differences from the artifact

Not in the artifact.
