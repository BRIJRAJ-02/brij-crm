# Tabs

Sections of one page, one at a time.

## Why it exists

Ported from the artifact's Tabs card. A record's Activity, Notes, Tasks, Emails and Files (#17) and the settings pages switch this way. It wraps React Aria's `Tabs`, and its underline is React Aria's `SelectionIndicator`.

## Use

```tsx
<Tabs
  label="Record"
  tabs={[
    { id: 'activity', label: 'Activity', icon: 'activity' },
    { id: 'notes', label: 'Notes', count: 12 },
  ]}
>
  <TabPanel id="activity">…</TabPanel>
  <TabPanel id="notes">…</TabPanel>
</Tabs>
```

- Each tab can have an `icon` and a `count` (a Badge). `countMax` raises the highest count shown as itself (99 by default, then "99+"), and `isCountAtLeast` marks a capped count as a floor ("10,000+", a record's open tasks, spec 0019).
- One `TabPanel` per tab, with the same `id`.
- `end` puts the chosen tab's own tools at the far end of the strip, on its hairline: Captures' search and New (LinkListToolbar at `size="sm"`). The tabs keep their place; when both don't fit (a phone), the tools wrap to a row of their own under the tabs and shrink to the width, so the tabs are never squeezed.
- Only one panel shows at a time; use Disclosure for sections that can all be open.

## States

Chosen (text with the underline), hover (pointer only), focus, disabled. The underline slides over `duration-move` for a pointer, and jumps for the keyboard and under reduced motion.

## Keyboard

The arrow keys move between tabs and choose; Home and End jump; Tab moves into the panel.

## Differences from the artifact

- `tabs` keep `id`, `label`, `icon` and `count`; panels are `TabPanel` children rather than rendered by the caller beside the bar.
