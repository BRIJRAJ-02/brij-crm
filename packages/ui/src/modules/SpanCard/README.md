# SpanCard

The card a span drawn on a week opens (spec 0027): the span and its day, then what it can become.

## Why it exists

Drawing on Bookings › Calendar (timefix's "draw on the calendar") opens one small card beside the drawn span: its time and day on top, then Book someone in, Block this time and Hold for a private page, and once one is picked, that choice's short form with Back. No existing piece fits: a Menu closes on a pick and can't hold a form, a Popover's dialog has no header of its own, and Card is a bordered, raised surface, which inside a popover would be a card in a card. So the layout lives here once, and WeekCalendar's `draftCard` holds it.

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
- Its width comes from the Popover around it (`width="menu"`, 240px, close to timefix's 264px card); it sets none of its own.
- `isBusy` while the form saves disables Back; disable the form's own controls too, so the span can't change under the save.
- `focusKey` names what the card shows (`choose`, `block`, `hold`). When it changes, focus moves to the first control below the span, because the control that was pressed is gone.

## States

Choices, a form, and whatever the form shows (pending, an error Callout). Saving closes the card; the screen confirms with a toast. Hover and focus come from Button.

## Keyboard

Tab moves through Back, the choices or the form. Picking a choice, Back and a save move focus to the first control of what shows next. The Popover around it closes on Escape.
