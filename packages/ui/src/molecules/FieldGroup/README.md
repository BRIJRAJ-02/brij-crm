# FieldGroup

A labelled block of read only content in a form's rhythm: a Field's label above, a quiet action at that row's end, the content, then one hint line.

## Why it exists

New (22 October 2026), for the booking page editor's Hours tab. It shows a schedule's week and the calendars checked for conflicts among real fields, and the owner asked that every label there sit above its content in the same style as the Schedule select, with no inline label rows. Field draws one input, DescriptionList puts its terms beside their values, and Card adds a box and a title in another style, so none of them could label read only content the way a field is labelled. SettingsRow puts its label at the far left and its control at the far right.

## Use

```tsx
<FieldGroup label="Weekly hours" action={<Button variant="ghost" size="sm">Edit</Button>} hint="Kolkata time (GMT+5:30)">
  <DescriptionList items={[{ term: 'Mon to Fri', description: '9:00 AM to 5:00 PM' }]} />
</FieldGroup>
```

- `action` takes a quiet control (a ghost `sm` Button) at the label row's end. It overhangs the label's line, so the content starts where a Field's box would.
- `meta` puts a short fact after the label on its line, a step quieter: a schedule's zone ("Weekly hours · Kolkata time (GMT+5:30)").
- `layout="row"` sets the content in a wrapping row `space-6` apart: a few Badges with a colour dot, then a Button.
- `tone="strong"` sets the label medium, for a section heading over a DescriptionList's own quiet terms (a form submission's Answers, Where it came from and Records in a stacked Panel, 22 October 2026), so the heading and the terms under it don't read as one level. `headingLevel` (2, 3 or 4) draws the label as that heading, so screen readers move between the sections by heading. The label is FieldLabel itself (`as="text"`, with its `id` naming the group), so a group's label and a field's never drift; `meta` sits after it, outside the group's name.
- It is a `group` named by its label and described by its hint.

## States

With and without an action and a hint, block and row, a long row that wraps, loading (a Skeleton as content), empty (a hint and the action that fixes it). Loading, error, read only and disabled belong to its content (Skeleton, Callout).

## Keyboard

Tab reaches the action and anything in the content. The group itself takes no focus.

## Differences from the artifact

Not in the artifact.
