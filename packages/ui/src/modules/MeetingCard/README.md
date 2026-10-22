# MeetingCard

One meeting's details: a booking, a calendar event, closed time. The card a week's block opens, the side panel Bookings › List opens, and the sheet a phone opens.

## Why it exists

New (22 October 2026, the owner's "fix this UI" on the week's booking card). The card was a loud Confirmed badge over the page's name in small grey, then label and value stacks for When, Who and Where, a raw meeting address, a second "Join call" link, the chat as a disclosure and three outlined buttons, the red one among them, filling the card edge to edge. Google Calendar, Calendly, Cal.com and Notion Calendar agree on a different shape: the title first at the title size with its time under it, the status quiet, then one row per fact with its icon in a column of its own (who with an avatar and their email, where by its provider with one Join), and the actions in a footer, the primary first and an ending action apart. No library piece holds that: DescriptionList puts a term over or beside each value, with no icon column and no people with avatars; SpanCard is a drawn span's choices; Card is a bordered surface, which inside a popover would be a card in a card. So the layout lives here once, for every kind of meeting.

## Use

```tsx
<MeetingCard
  title="Grace Hopper · Intro call"
  when="Friday, October 23 · 9:00 – 9:30 AM"
  status={{ label: 'Confirmed', hue: 'green' }}
  people={[{ id, name: 'Grace Hopper', href, detail: 'grace@navy.mil', isDetailCopyable: true }]}
  rows={[{ id: 'where', icon: 'video', label: 'Where', value: 'Google Meet' }]}
  actions={
    <>
      <ButtonLink variant="primary" icon="video" href={url} isExternal label="Join Google Meet">
        Join
      </ButtonLink>
      <Button>Reschedule</Button>
    </>
  }
  endAction={
    <Button variant="ghost-danger" size="lg" icon="circle-x">
      Cancel booking
    </Button>
  }
/>
```

- `title` is the card's heading (`headingLevel`, 2 by default) and names the card (an `article`). Lead with who and what, never a status.
- `status` is a StatusDot beside the time: a quiet dot and its word, never the loudest thing on the card.
- `notices` go under the heading: a Callout that has to be read first (the calendar event couldn't be made, it needs a host).
- `people` is the first row: each person with their avatar, their name (a link with `href`), and a muted `detail` under it (an email, or their part, "Host"), which `isDetailCopyable` follows with an icon only copy button. Emails are never drawn as mailto links.
- `rows` are the other facts, each `{ icon, label, value, detail?, action?, children? }`: the icon in its column (the `label` is read in its place, so the list stays a real `<dl>`), the value in the text colour, a quieter `detail` line, a quiet control at the row's end (`action`, "View chat (3)") and anything it opens under the row (`children`, the transcript). A long email wraps inside the card rather than being cut.
- `headingLevel`: 2 by default; 4 under a dialog's own heading (a Panel's or the sheet's, level 3), 3 in a popover with none.
- `actions` are one row that never wraps (22 October 2026: the owner's "fix" on a wrapped footer), the primary first: at most Join, one more and an overflow menu, as Google Calendar and Cal.com keep theirs (Join, Reschedule, More holding Copy guest link and Cancel booking). `endAction` sits apart at its end (closed time's Remove), a quiet ending action such as a `ghost-danger` Cancel booking in words (as Calendly and Cal.com write it; an icon alone read as a close on a phone's sheet), which still asks first in a Modal. The footer wraps rather than stretching a button.
- It has no surface or padding: the Popover, Panel (`isStacked`) or Modal (`variant="sheet"`) around it is the card. Its width is its holder's, at most `size-panel`.

## Layout

Google Calendar's alignment (the owner, 22 October 2026: "better alignment"): every line of text starts on one text column, the header's, the rows', the notices' and the footer's buttons alike. A gutter to its left (`space-24`, an avatar's width, then `space-12`) holds each row's icon or avatar, one per row, centred on the row's first line (the lead is one body line tall). One rhythm, `space-12`, between the header, every row and the footer's hairline, and under it. The footer and its hairline span the content from the gutter's edge, its buttons `size="lg"` (30px, pressed at 32px) on one row. The avatar fills the gutter (`md`, 24px) and icons are `md` (16px); every quieter line (the time, an email, a row's detail) is `text-secondary` at the body size. The email's copy button keeps its 26px target but takes only the email's line, with its name in a Tooltip.

## States

Upcoming with a call (Join primary), confirmed with no call, cancelled (status Canceled, a reason row, no footer), needs a host (a notice), long names and emails (the title and the email wrap inside the card), booked by chat (a row whose View chat opens the transcript under it). Hover, focus, pressed, pending and disabled come from its buttons and links; read only is a footer with Join alone, or none. Loading and failure belong to its holder (a Skeleton or an EmptyState in the Panel or Popover).

## Keyboard

Tab goes through the people's links and copy buttons, each row's action, then the footer's actions in order and the ending action last. The holder (a Popover or sheet) closes on Escape and returns focus.

## Differences from the artifact

Not in the artifact.
