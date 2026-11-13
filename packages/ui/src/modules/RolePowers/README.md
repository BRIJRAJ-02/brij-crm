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
    {
      id: 'capture',
      title: 'Forms and booking',
      standing: 'some',
      held: ['Make booking pages'],
      withheld: ['Change other people’s booking pages'],
    },
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

## Timefix prototype (spec 0072)

Takes its look from the prototype's role powers, on the library's one-role shape: the summary is the prototype's note (`text-body-sm` in `text-tertiary`), the areas are Disclosure folds `space-12` apart, and each opened fold lists its powers as the prototype's power rows: at least `size-control-sm` tall (`space-4` above and below a wrapped one; the prototype's 44px rows hold two lines and checkboxes, these one line, so they keep the library's density), `text-body`, a `border-subtle` hairline between them, the ones held at full contrast after a success check, the ones not held in `text-tertiary` after a minus. The folds open with Disclosure's accordion motion (transitions.dev 21), and several may be open.

**Use it for** what a role lets someone do: Settings › Members' role guide and the Invite dialog. **Don't use it for** one person's access (show their role) or picking a role (Select with described options).

**The consumer provides** `label`, `areas` (`{ id, title, standing, held, withheld }`, from `rolePowers(role)`), and as needed `summary`, `header` (the role switch), `id` and `isLoading`.

**States**: folds closed or open (several at once), each area's standing (All, Some, None, in a mark and a Badge), loading. Stories: Closed, Opened, SeveralOpenByKeyboard, WithoutSummary, Loading.

**Interaction**: Tab reaches each area's title; Enter or Space opens and closes it.

**Differences from the prototype**
- The prototype is a matrix: every role a column, a checkbox in every cell, Owner locked, "Custom role" adding a column and deleting one asking first. The library part explains one role read only (the owner, 27 October 2026), so the matrix, its checkboxes, the locked Owner column, the new column's fade and the add and delete dialogs are not ported; an editable roles matrix is owed to the roles screen phase, as a part of its own if the owner wants custom roles.
- Each area carries a standing mark and a Badge (All, Some, None), and a power not held is listed with "Can’t:" read before it, where the prototype's empty checkbox says it.
- A power has no grey description line: the library's powers are one plain sentence each.
