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
- `variant="bar"` makes the tabs a page's second bar, the row People's ViewBar takes under the TopBar: size-bar tall on the surface, the same padding and hairline, held at the top of the view while the page under it scrolls (Captures, Bookings; the owner, 21 October 2026: the scheduling pages' chrome as the CRM pages'). The bar's first tab label starts at the page's 16px gutter, under the TopBar's title, and the tabs keep their whole width, so on a phone the tools wrap under them instead of cutting a tab (the owner, 21 October 2026: the labels sat 8px in from the trail, and Tasks' third tab was cut at 375). The default `strip` is 40px tabs inside a page (a record's tabs).
- `inset="none"` (for the strip; the bar keeps its own padding) drops the strip's 16px inset at both ends, for a full width strip outside a settings page (a settings page gets the page edge, below, without asking), so the first tab's label lines up with the full width Table's first column under it, and the tools end at the table's edge (Members and Invitations). The tabs keep their whole width, so on a phone a lone search wraps to a row under them rather than squeezing the last tab. Why a variant: the inset a record panel's tabs need from the panel's edge pushed the labels 24px in from the table's text (owner feedback, 21 October 2026).
- Directly in a settings page's body (SettingsLayout, which sets the library's page edge) a strip needs neither: it runs out through the page's gutter to its edges, the bar's height, its first label on the content edge where the body's headings and table text start, so every settings page gets it without asking (22 October 2026). Inside a Card, Modal, Popover or Panel the strip keeps its own inset.
- `end` puts the chosen tab's own tools at the far end of the strip, on its hairline: Captures' search, Bookings' week and its arrows (LinkListToolbar at `size="sm"`). The tabs keep their place; when both don't fit (a phone), the tools wrap to a row of their own under the tabs and shrink to the width, so the tabs are never squeezed.
- `alert` on a tab draws a small danger dot after its label and says its text to screen readers ("Meeting, Needs a fix"): a field on that tab holds an error the person can't see from the tab they are on. Why: the booking page editor splits its fields across tabs, so an error on another tab was invisible (the owner, 22 October 2026). The dot is never the only cue; the field itself says the error once its tab is open.
- `TabPanel variant="fields"` stacks the panel's content `space-16` apart, as a Form stacks its fields, `space-16` under the strip, for a tab of fields with no Card around them (the booking page editor). Why a variant: a panel lays out nothing, so its fields sat flush.
- Only one panel shows at a time; use Disclosure for sections that can all be open.
- When each tab is a page of its own, give each its `href`. It doesn't navigate (the page's `onSelectionChange` does); it marks the tab with `data-href`, so the app loads that page while a pointer rests on the tab.

## States

Chosen (text with the underline), hover (pointer only), focus, disabled, with an alert dot. The underline slides over `duration-move` for a pointer, and jumps for the keyboard and under reduced motion.

## Keyboard

The arrow keys move between tabs and choose; Home and End jump; Tab moves into the panel.

## Differences from the artifact

- `tabs` keep `id`, `label`, `icon` and `count`; panels are `TabPanel` children rather than rendered by the caller beside the bar.
