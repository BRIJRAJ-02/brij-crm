# RecordLayout

A record's page: its header, a tab bar with the chosen tab's panel under it, and a fixed sidebar of details on the right.

## Why it exists

New (spec 0017). No module laid out a header, a tab bar with its panel, and a fixed sidebar together: AppShell's slots are the app frame around a page, and RecordPanel is a floating panel beside a table. A screen may not write its own layout markup, so the record page needs this. It adds only the layout: the header slot takes a RecordHeader, the tabs are the Tabs molecule, the narrow sidebar is the Disclosure molecule, and the slots hold AttributeList, ActivityFeed and the rest. No new tokens.

## Use

```tsx
<RecordLayout
  header={
    <RecordHeader record={display} objectName="Company">
      {copyLink}
    </RecordHeader>
  }
  tabs={[
    { id: 'overview', label: 'Overview', icon: 'layout-dashboard' },
    { id: 'activity', label: 'Activity', icon: 'activity' },
  ]}
  selectedTab={tab}
  onTabChange={openTab}
  sidebarLabel="Details"
  sidebar={<AttributeList label="Details" sections={sections} onCommit={save} />}
  notice={
    isDeleted && (
      <Callout tone="danger" placement="banner">
        This company was deleted.
      </Callout>
    )
  }
>
  {tab === 'activity' ? <ActivityFeed label="Activity" entries={feed} /> : <Overview />}
</RecordLayout>
```

- It fills its slot (the AppShell's view). At or above `bp-container-md` plus `size-panel` (880px: the sidebar, and at least a medium container beside it) the main column holds the header over the tabs, and the sidebar sits on the right at the Panel molecule's width (`size-panel`) with a hairline before it. The tab panel and the sidebar each scroll inside themselves at the slot's full height.
- Below that one column scrolls: the header, then the sidebar inside a Disclosure titled `sidebarLabel`, closed by default, then the tabs, whose panel keeps the slot's whole height so a feed still scrolls inside it. The width is measured in script (a ResizeObserver against the two tokens), because the two layouts are different trees: the sidebar is drawn once, never twice. So crossing the width remounts the sidebar: an editor open in it closes and its draft goes, and an uncontrolled Disclosure closes again.
- `children` is the chosen tab's panel only; the page decides what each tab shows. Switching tabs calls `onTabChange` (the page keeps the tab in its address).
- `isSidebarExpanded` and `onSidebarExpandedChange` control the narrow Disclosure, so a page can open it before moving focus into the sidebar ("View all" on Overview, spec 0017).
- `notice` spans the top of the page, flush: a banner Callout for a deleted record, or for one no longer available.
- When the tab changes while focus was inside the panel (a "View all" there, which leaves with the panel), focus moves to the chosen tab rather than falling to the page.
- `isLoading` marks the page busy; the header, the sidebar and the panel draw their own skeletons (RecordHeader, AttributeList and ActivityFeed each take their loading state).

## States

Wide, narrow (the Disclosure closed, and open), loading, read only (a notice over the page, with the details passed no editor). Focus on a tab (the inset ring, from Tabs), on the Disclosure's toggle (from Disclosure).

## Keyboard

Tab order follows what you see: the header's actions, the tab list (the arrows switch tabs), the panel, then the sidebar. On a narrow page the Disclosure's toggle comes before the tabs; Enter or Space opens it.

## Differences from the artifact

The artifact has no record page layout card yet; this is new in code. Not yet published to the design system artifact (the owner publishes it).
