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
- `stats` puts the record header's stat strip (`RecordStats`) over the tabs: open tasks, notes, the last activity, each opening its tab through `onPress` (pair it with `selectedTab` and `onTabChange`). The leading avatar is `md` (24px), a step up from the bar's icons (13 Oct reference batch 4).
- `notice` puts one line over the tabs, such as a danger `Callout` saying the record is no longer available (it stays read only until closed). `empty` replaces the tabs with the screen's own `EmptyState`, for a record that isn't available (missing or hidden read as one state, spec 0017 AC-384); the header keeps Close. Why props: the record page says both in its own layout, and the peek over a table or board (the CRM flow pass, 31 October 2026) has only the panel to say them in; `no-access` asks for access, which a deleted record can't be given.
- `status`: `loading` (leave out `record`; skeletons show in place of the tabs), `error` (with Try again from `onRetry`), or `no-access`.
- `isStepping` marks a step on its way, the next record loading while this one stays (the record panel over a table or board, 31 October 2026): after the loading delay a thin indeterminate progress line shows along the body's top edge, with no change of layout (the tabs keep their full colour: dimmed, their labels fell under AA contrast); a step that lands quickly shows nothing, and the body is `aria-busy` meanwhile. Why a prop: only the screen knows the next record is on its way (a held ↑ or ↓, or a page of the list loading).
- Stepping onto the first or last record disables the button you pressed; focus moves to the other one.

## States

Open (with its stat strip, its stats loading, or none; with a notice), unavailable (`empty`), closed (with the panel's exit animation), loading, failed, no access. Each tab's content brings its own loading, empty and error states.

## Keyboard

Focus moves into the panel when it opens. ↑ and ↓ step to the record above or below, as Previous and Next do, wherever nothing else in the panel owns the arrows (a field, the tabs, a list); the content swaps at once, with no motion. Esc closes it, and focus returns to where it was; Esc inside an editor cancels the edit first. Tab moves through the header's buttons, the stats that go somewhere, the tabs (the arrows switch between them), then the tab's content.

## Differences from the artifact

The artifact's record page has no side panel.

## Timefix prototype (spec 0072)

Takes its look from the prototype's RecordPanel body: the record's content padded `space-16` all round under the panel's bar (a notice and the stat strip padded `space-16` over the tabs), each tab's content scrolling in its own slot. The panel's surface, `shadow-lg` with its `border-subtle` ring, `radius-lg`, its bar and its motion (transitions.dev 07 panel reveal) are the floating Panel's, which phase 2's Panel part ports; the content swap is instant here, as the library's house rule for a key pressed hundreds of times a day asks (below). The prototype's side column of RecordLayout and its RelatedRecords sections are folded into this part: see their READMEs.

**Use it for** previewing a record from a table, board or search beside the list. **Don't use it for** settings or forms (a Modal or Panel) or as the record's full page (RecordLayout).

**The consumer provides** `record`, `isOpen` and `onClose`, `tabs` (the body: Details through AttributeList, Activity, Tasks), `onPrevious` and `onNext` at each step, and `onOpenPage`.

**States**: closed (not rendered), open, switching records, first and last record (the button at that end disabled), with a notice, unavailable, stepping, loading, failed, no access. Stories: `Default`, `OpenAndClose`, `StepThrough`, `ArrowKeysStep`, `JAndKStep`, `NoLongerAvailable`, `Unavailable`, `Stepping`, `Loading`, `NoAccess`.

**Interaction**: it takes focus as it opens; Esc closes it and hands focus back to what opened it (`OpenAndClose`). ↑ and ↓ (and J and K) step through the list, as Previous and Next do.

**Differences from the prototype**
- Built on the floating Panel with Tabs, not a bar over one scrolling body: the prototype's `objectName` bar label is not drawn; the header shows the record's avatar and name, its place in the list under them, and the J/K hint line sits at the foot (below, spec 0074). Tabs, the stat strip, `notice`, `empty`, `actions`, `isStepping` and `status` are kept beyond it.
- The library steps with J and K as well as ↑ and ↓, as the prototype does (spec 0074), and swaps the content at once rather than sliding it 8px (no `PageSlide`), so a held key never queues motion.
- `recordKey` and `position` are the library's `record`, `place`, `onPrevious` and `onNext`; `onExpand` is `onOpenPage`; `label` is the record's name.
- The prototype's `AttributeRow` and `RecordSection` are the library's AttributeList rows and Disclosure (through RelatedRecords).

## Place, keys and box (spec 0074, batch 5)

- `place` says where the record is in the list beside it, under its name ("People · 3 of 120", AC-7412), as the Panel's subtitle; left out where the panel wasn't opened from a list.
- J and K step as ↓ and ↑ do (`lib/step-keys.ts`), never from a field, a listbox or a grid; the keys sit in one quiet line at the panel's foot (J K "next and previous", ESC "close", J and K only where there is a list to step through), drawn as the command palette's foot hint is: caption type, each key beside its words, the pairs `space-16` apart.
- The floating Panel sits over the content area at its full height, below the top bar and `space-8` in from the other edges, never pushing the table or board; `size-panel` wide (the record panel no longer asks for `lg`); it enters over `duration-slow` and leaves over `duration-quick` (the house's exit) on `ease-smooth-out`, and reduced motion keeps only the fade (AC-7411).
