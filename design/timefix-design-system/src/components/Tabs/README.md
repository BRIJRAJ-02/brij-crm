Tabs switch between sections of one page, such as a record's Overview, Activity, Emails and Notes, with an accent underline that slides to the chosen tab.

**Use it for**: sections of a record, a booking page's settings, the Meetings list's Upcoming / Past split. **Don't use it for**: switching how the same data is drawn (table, board, calendar), which is a `SegmentedControl`, or moving between pages in the app, which is the sidebar.

**The consumer provides**: `items` (`id`, `label`, optional 16px `icon`, optional `count`, `isDisabled`), an `aria-label`, `selectedKey` with `onSelectionChange` (or `defaultSelectedKey`), and `TabPanel`s whose `id` matches. Leave the panels out when the tabs drive the route.

**States**: rest (grey label), hover (ink label), selected (ink label over a 2px accent line), focus-visible (ring inside the tab), disabled. The label keeps its weight when selected, so nothing shifts.

**Interaction**: Tab focuses the selected tab, Left and Right move and select, Home and End jump. The line is measured onto the selected tab and slides over 250ms on the smooth-out curve (transitions.dev 16, tabs sliding, drawn as an underline); it snaps on first paint and on resize. When the tabs overflow, the bar scrolls sideways with no scrollbar and centres the chosen tab.

**Replaces**: Tabs, SectionTabs.
