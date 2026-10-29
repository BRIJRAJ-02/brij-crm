# RolePowers

What a role lets someone do, area by area: Settings › Members and the Invite dialog (the owner, 27 October 2026: "letting someone know what access does what").

## Why it exists

New. A role picker offered a name and one sentence, so someone choosing a role for a colleague was guessing. The full truth is 23 permissions, and a 23 row table is a wall. This groups them into six areas (`PERMISSION_AREAS` in `@crm/contracts/role-powers`), shows each area's standing at a glance (All, Some, None) and keeps the detail one press away. DescriptionList pairs a term with one value and has no fold; Disclosure alone has no standing mark or held/not held list; a Table's cells take arrow keys and a header, which a short read only explanation doesn't need. So it composes Disclosure, Badge and Icon, with only its marks and power rows styled here.

## Use

```tsx
<RolePowers
  label="What an Admin can do"
  summary="Everyone can see and change records, and make notes, tasks and comments."
  areas={[
    { id: 'capture', title: 'Forms and booking', standing: 'some', held: ['Make booking pages'], withheld: ['Change other people’s booking pages'] },
  ]}
/>
```

- A `<section>` named by `label`. `summary` is one quiet line above the areas: what everyone can do whatever their role, so a role holding few permissions doesn't read as "almost nothing".
- Each area is a Disclosure (h4) with its mark before the title: `circle-check` in the success colour for All, `circle-dot` for Some, `minus` for None, and the standing in words in a Badge after it, so colour and shape never carry it alone.
- Opened, the held powers come first with a check, then the ones not held, quieter with a minus and read with "Can’t:" before each.
- Several areas may be open at once.
- The screen derives the areas from `rolePowers(role)`, so what it shows can't drift from what the server enforces.

## States

- Default: the areas, closed.
- Opened: one or more areas showing their powers.
- `isLoading`: skeleton rows, `aria-busy`.
- Empty, error and no access belong to the screen around it.

## Keyboard

Tab reaches each area's title; Enter or Space opens and closes it.

## Differences from the artifact

Not in the artifact.
