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
  endAction={<Button variant="ghost-danger" icon="circle-x" label="Cancel booking" />}
/>
```

- `title` is the card's heading (`headingLevel`, 2 by default) and names the card (an `article`). Lead with who and what, never a status.
- `status` is a StatusDot beside the time: a quiet dot and its word, never the loudest thing on the card.
- `notices` go under the heading: a Callout that has to be read first (the calendar event couldn't be made, it needs a host).
- `people` is the first row: each person with their avatar, their name (a link with `href`), and a muted `detail` under it (an email, or their part, "Host"), which `isDetailCopyable` follows with an icon only copy button. Emails are never drawn as mailto links.
- `rows` are the other facts, each `{ icon, label, value, detail?, action?, children? }`: the icon in its column (the `label` is read in its place, so the list stays a real `<dl>`), the value in the text colour, a quieter `detail` line, a quiet control at the row's end (`action`, "View chat (3)") and anything it opens under the row (`children`, the transcript).
- `actions` sit at the footer's start, the primary first (Join while a call can be joined); `endAction` sits apart at its end, a quiet ending action such as an icon only `ghost-danger` Cancel booking, which still asks first in a Modal. The footer wraps rather than stretching a button.
- It has no surface or padding: the Popover, Panel (`isStacked`) or Modal (`variant="sheet"`) around it is the card. Its width is its holder's, at most `size-panel`.

## States

Upcoming with a call (Join primary), confirmed with no call, cancelled (status Canceled, a reason row, no footer), needs a host (a notice), long names and emails (the title wraps, an email cuts with an ellipsis inside the card), booked by chat (a row whose View chat opens the transcript under it). Hover, focus, pressed and pending come from its buttons and links.

## Keyboard

Tab goes through the people's links and copy buttons, each row's action, then the footer's actions in order and the ending action last. The holder (a Popover or sheet) closes on Escape and returns focus.

## Differences from the artifact

Not in the artifact.
