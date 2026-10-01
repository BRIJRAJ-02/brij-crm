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
- Typing filters by the icon's name ("build" finds Building and Building complex).

## States

Focused cell, chosen cell, no matches.

## Keyboard

Typing filters; the arrow keys move through the grid; Enter chooses.

## Differences from the artifact

Not in the artifact.
