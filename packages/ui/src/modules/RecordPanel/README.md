# RecordPanel

A record opened beside the table: its avatar and name, Previous and Next, Open full page, and its tabs.

## Why it exists

New. Clicking a record in a view (#17) opens it beside the table instead of leaving the page. It is the floating `Panel` (`variant="floating"`, `isFlush`) with the record's `Avatar` as its leading slot, `Button`s for stepping and opening, and `Tabs`. What only it adds is the layout of each tab: the content fills the panel's height, so an `ActivityFeed` or `TaskList` scrolls inside it.

## Use

```tsx
<RecordPanel
  record={company}
  isOpen={isOpen}
  onClose={close}
  onPrevious={previous}
  onNext={next}
  onOpenPage={() => navigate(company.href)}
  tabs={[
    { id: 'details', label: 'Details', content: <AttributeList … /> },
    { id: 'activity', label: 'Activity', count: 9, content: <ActivityFeed … /> },
    { id: 'tasks', label: 'Tasks', count: 5, content: <TaskList hideRecord … /> },
  ]}
/>
```

- `record` is the record's display shape: its name, kind (a person's avatar is a circle, others square), and picture or hue.
- Leave out `onPrevious` or `onNext` at either end of the view; the button stays, disabled, so the header doesn't shift. Leave out both to hide them.
- `selectedTab` with `onTabChange` keeps the tab when the person steps to another record.
- `actions` go before the close button, such as the record's menu.
- `status`: `loading` (leave out `record`; skeletons show in place of the tabs), `error` (with Try again from `onRetry`), or `no-access`.
- Stepping onto the first or last record disables the button you pressed; focus moves to the other one.

## States

Open, closed (with the panel's exit animation), loading, failed, no access. Each tab's content brings its own loading, empty and error states.

## Keyboard

Focus moves into the panel when it opens. Esc closes it, and focus returns to where it was; Esc inside an editor cancels the edit first. Tab moves through the header's buttons, the tabs (the arrows switch between them), then the tab's content.

## Differences from the artifact

The artifact's record page has no side panel.
