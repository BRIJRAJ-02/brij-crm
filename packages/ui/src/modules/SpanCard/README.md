# SpanCard

The card a span drawn on a week opens (spec 0027): the span and its day, then what it can become.

## Why it exists

Drawing on Bookings › Calendar (timefix's "draw on the calendar") opens one small card beside the drawn span: its time and day on top, then Book someone in, Block this time and Hold for a private meeting type, and once one is picked, that choice's short form with Back. No existing piece fits: a Menu closes on a pick and can't hold a form, and a Popover's dialog has no header of its own. So the layout lives here once, and WeekCalendar's `draftCard` holds it.

## Use

```tsx
<SpanCard
  title="10:00 – 10:30 AM"
  meta="Tuesday 20 October · 30 min"
  choices={[{ id: 'block', label: 'Block this time', icon: 'circle-slash', onPress: () => setMode('block') }]}
/>

<SpanCard title="10:00 – 10:30 AM" meta="Tuesday 20 October · 30 min" onBack={() => setMode('choose')}>
  <RadioGroup label="How often">…</RadioGroup>
  <Button variant="primary">Block it</Button>
</SpanCard>
```

- `choices` draws the list of quiet full width buttons; leave it off and pass the picked choice's form as children.
- `onBack` shows Back before the title.
- It is the sidebar's width, like timefix's 264px card.

## States

Choices, a form, and whatever the form shows (pending, an error Callout, a done message). Hover and focus come from Button.

## Keyboard

Tab moves through Back, the choices or the form. The Popover around it closes on Escape and puts focus back.
