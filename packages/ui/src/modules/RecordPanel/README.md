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
- The header (owner, 31 October 2026): Previous and Next sit together as one pair, then a gap, then Open full page and Close; each is an icon button with a tooltip, the steps' tooltips showing their ↑ and ↓ keys (keycaps no longer sit inside the buttons, where they read as a third arrow).
- `facts` and `quickActions` put the record at a glance under the header: its key facts as `RecordFacts` (a person's job title, company, email, phone) and one row of quick actions (Email, Call, Log activity, Add task). Why props: the panel had only the name, so you opened the full page to see who someone was (owner, 31 October 2026).
- Leave out `onPrevious` or `onNext` at either end of the view; the button stays, disabled, so the header doesn't shift. Leave out both to hide them.
- `selectedTab` with `onTabChange` keeps the tab when the person steps to another record.
- `actions` go before the close button, such as the record's menu.
- `stats` puts the record header's stat strip (`RecordStats`) over the tabs: open tasks, notes, the last activity, each opening its tab through `onPress` (pair it with `selectedTab` and `onTabChange`). The leading avatar is `md` (24px), a step up from the bar's icons (13 Oct reference batch 4).
- `notice` puts one line over the tabs, such as a danger `Callout` saying the record is no longer available (it stays read only until closed). `empty` replaces the tabs with the screen's own `EmptyState`, for a record that isn't available (missing or hidden read as one state, spec 0017 AC-384); the header keeps Close. Why props: the record page says both in its own layout, and the peek over a table or board (the CRM flow pass, 31 October 2026) has only the panel to say them in; `no-access` asks for access, which a deleted record can't be given.
- `status`: `loading` (leave out `record`; skeletons show in place of the tabs), `error` (with Try again from `onRetry`), or `no-access`.
- `isStepping` marks a step on its way, the next record loading while this one stays (the record panel over a table or board, 31 October 2026): after the loading delay a thin indeterminate progress line shows along the body's top edge, with no change of layout (the tabs keep their full colour: dimmed, their labels fell under AA contrast); a step that lands quickly shows nothing, and the body is `aria-busy` meanwhile. Why a prop: only the screen knows the next record is on its way (a held ↑ or ↓, or a page of the list loading).
- Stepping onto the first or last record disables the button you pressed; focus moves to the other one.

## States

Open (with its facts and quick actions; with its stat strip, its stats loading, or none; with a notice), unavailable (`empty`), closed (with the panel's exit animation), loading, failed, no access. Each tab's content brings its own loading, empty and error states.

## Keyboard

Focus moves into the panel when it opens. ↑ and ↓ step to the record above or below, as Previous and Next do, wherever nothing else in the panel owns the arrows (a field, the tabs, a list); the content swaps at once, with no motion. Esc closes it, and focus returns to where it was; Esc inside an editor cancels the edit first. Tab moves through the header's buttons, the stats that go somewhere, the tabs (the arrows switch between them), then the tab's content.

## Differences from the artifact

The artifact's record page has no side panel.
