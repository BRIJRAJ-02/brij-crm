# PersonLine

One person as a line of a roster: their picture, their name, and one quiet line under it, with room at the end for a chip or a menu.

## Why it exists

New, lifted out of TeamWeek's person cell when the Team day (spec 0030) needed the same person in each column's head: the design-system review found the two drawn twice, line for line. Avatar is the picture alone and RecordChip is a link to a record; neither carries the name over a quiet line with a status in it. TeamDay's column heads use it now; TeamWeek's person cell moves onto it once the roster lane that is reworking TeamWeek lands, so both change in one place after that.

## Use

```tsx
<PersonLine id={member.id} name="Sam Lee" meta={['3 booked', 'UTC+1', 'Account executive']} size="sm" end={<Badge … />} isDecorative />
```

- `meta` is the quiet line's parts in order, joined by a middle dot. The line is cut at its end, so put what it is about first (a status, the week's hours) and the least needed last (a job title).
- `tone="away"` draws the first part in the Away colour, strong (time off): the one state that changes what can be done with the person.
- `size` is the picture's: `sm` in a calendar column's head, `md` in a table row.
- `end` sits after the name, never cut: a health chip, a view only mark, a row's menu.
- `isDecorative` hides it from screen readers where the thing it heads already names the person in full (TeamDay's columns carry the whole name, status and offset in their label).

## States

Quiet, away, with and without `end`, truncated name and line. Below 320px of its container an `md` line gives its picture's room to the name. Every text colour is a token that meets 4.5:1 in both themes.

## Keyboard

None of its own: it is a label. What sits in `end` keeps its own keys.

## Differences from the artifact

Not in the artifact.
