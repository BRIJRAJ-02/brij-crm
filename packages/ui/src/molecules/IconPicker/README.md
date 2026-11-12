# IconPicker

Pick an object's icon from the curated set, with a search.

## Why it exists

New. Object settings (#13) let people choose an icon for each object. It offers only the curated `ObjectIcon` set (about 150 Lucide names, listed in contracts and imported by the icon registry), so the bundle never carries Lucide's full set or its dynamic loader. It wraps React Aria's `Autocomplete` and a grid `ListBox`.

## Use

```tsx
<DialogTrigger>
  <Button icon={object.icon} label="Change icon" />
  <Popover label="Object icon">
    <IconPicker label="Object icon" value={object.icon} hue={object.hue} onChange={setIcon} />
  </Popover>
</DialogTrigger>
```

- `hue` draws each icon on that hue's tile, as the object will show.
- The search is the library's Field (`variant="search"`, `size="sm"`), as Select's searchable list draws it; it drew its own box before F27 (20 October 2026).
- Typing filters by the icon's name ("build" finds Building and Building complex).

## States

Focused cell, chosen cell, no matches.

## Keyboard

Typing filters; the arrow keys move through the grid; Enter chooses.

## Differences from the artifact

Not in the artifact.

## Timefix prototype (spec 0072)

Takes its look from the prototype's IconPicker grid: `radius-md` cells that wash `surface-hover` under the pointer or keyboard focus, the chosen icon on `accent-soft` with a 2px ring inside it, the outline focus ring drawn inside the cell (the scroller clips outside it), and "No icons match" in `text-body-sm` `text-tertiary`.

**Use it for** an object's, list's or page's icon from the curated set. **Don't use it for** a logo upload or emoji.

**States**: cell rest, hover or keyboard focus (the wash), chosen (tint and ring), focus visible (the ring), no matches.

**Differences from the prototype**
- This is the picker's body, not its trigger: the caller opens it from its own Button and Popover, so the prototype's tile trigger and its category pills are not here.
- Cells are `size-nav-item` tall in eight equal columns of `size-menu`, not `size-control` squares, which would not fit eight to a menu's width.
- The chosen ring is `accent-text` rather than `accent`: the same blue in light, the lighter blue in dark, where it holds 3:1.

