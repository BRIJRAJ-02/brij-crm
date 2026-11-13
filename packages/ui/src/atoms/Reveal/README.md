# Reveal

A public page's entrance, played once as it first draws (spec 0068, AC-6803, AC-6806): what it wraps rises `space-12` out of a soft blur, and each `order` (1 to 6) waits one stagger more than the one before, so a headline lands before its line and the rows after both. It is transitions.dev's texts reveal, built in CSS alone, so it costs no script and never replays on a re-render.

## Why a new part

Nothing in the library moved text in: the app never does (its first paint is simply there), and the booking page's own reveals live inside BookingFrame. The link page, and the business, event and menu pages after it, need the same entrance, so it is one part rather than a copy per module.

## States

There is one: it plays as it mounts. Under reduced motion it is simply there. `display="inline"` keeps it in its line (a word in a heading); `block` (the default) stands on its own.

## Use

The entrance (the default) is for public pages only, around a page's own words as they first draw (LinkPage's name, job title and bio). Never in the app (the app's one entrance is RevealDrop, below), and never around something that changes after the first paint (use NumberPop or a label swap for that).

## RevealDrop

`RevealDrop` (spec 0073, AC-7311, the prototype's DropIn; `RevealDrop.tsx` beside Reveal) is a row arriving in a list (a comment, a task, a booking that just came in): its height opens from nothing while it rises `distance-medium` over `duration-fast` on `ease-smooth-out`, with no blur, so it is the one entrance allowed in the app. `animate={false}` for rows that were there on load. The row is clipped only while it opens (until its animation ends or is cancelled, as when its list is hidden mid entrance), so a focus ring inside it is never cut once it is in; under reduced motion it only fades in, with no height opening and no rise (reduced motion keeps fades). `animate` defaults to `true` as the prototype's DropIn does, so pass `animate={false}` for every row a list draws on load. Why one part: BookingList, SettingsLayout, MatchCalendar and ReadyPanel each keep their own row entrance today; one part lets them share it as they are ported. Why a sibling and not Reveal's `variant="drop"` (as first built): the variant put its code and keyframes (232 B of JavaScript, 160 B of CSS gzipped) on every public page that draws Reveal's entrance, the guest menu and the link page among them (the port merge, 13 November 2026). Story: `Drop`.

```tsx
{rows.map((row) => (
  <li key={row.id}>
    <RevealDrop animate={row.isNew}>
      <TaskRow task={row} />
    </RevealDrop>
  </li>
))}
```

In a list the wrapper goes inside the `<li>`, never between `<ul>` and `<li>`.

## Differences from the artifact

Not in the artifact yet; it goes with the next `pnpm ui:artifact`. The stagger (a quarter of `duration-quick`), the pace (`duration-fast`) and the blur (`space-2`) come from tokens; transitions.dev's 500ms reveal is not on the token scale, so it takes the longest UI motion token.
