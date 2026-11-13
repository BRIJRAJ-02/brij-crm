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
- One `TabPanel` per tab, with the same `id`; or one `TabPanel` whose `id` follows the chosen tab, to keep its content mounted (an editor's preview). React Aria holds on to the panel id it first made, so `TabPanel` takes the id the chosen tab's `aria-controls` names.
- `variant="bar"` makes the tabs a page's second bar, the row People's ViewBar takes under the TopBar: size-bar tall on the surface, the same padding and hairline, held at the top of the view while the page under it scrolls (Captures, Bookings; the owner, 21 October 2026: the scheduling pages' chrome as the CRM pages'). The bar's first tab label starts at the page's 16px gutter, under the TopBar's title, and the tabs keep their whole width, so on a phone the tools wrap under them instead of cutting a tab (the owner, 21 October 2026: the labels sat 8px in from the trail, and Tasks' third tab was cut at 375). Its tabs sit a little closer than the strip's (space-6 each side, space-2 apart, no gap before the tools, whose own space-16 sets them apart), so six tabs and a tab's tools share one row at 1280 (31 October 2026: Bookings' Roster made six, and List's tools wrapped under them). The default `strip` is `size-control-lg` tabs inside a page (a record's tabs).
- `variant="feature"` is a product's areas on its own home page (the marketing site's first fold, 23 October 2026): equal columns across the width, each an Icon tile (`hue`), its `label` in title type and a `description` line, quiet until chosen; the indicator runs along the columns' top hairline instead of under them. Under the page's compact breakpoint (a phone or a tablet) the row scrolls as the strip does, each tab as wide as its tile and label on one line, the descriptions gone, the ends fading where there is more (a page query, as Modal's: a column's own width on a 1440 screen is already under the 320px container step). The description is `aria-hidden`, so a tab is named by its label alone, as the app's tabs are. Why a variant: the site's tabs must behave as the app's (arrow keys, the sliding line), and nothing else in the library lays out four equal, described choices.
- `variant="pills"` is a guest page's categories (the guest menu's sections, after checklabs' category pills, owner 5 November 2026): outlined pills in a row that scrolls sideways with no hairline under it, the chosen one filled in the text colour, the fill sliding between pills as the strip's line does (at once for the keyboard, and under reduced motion). Colours are the surface's (`text`, `surface-raised`), so the menu's look wears it. It leaves the space under the row to the page, and a page that runs the row to the window's edges sets `--pills-inset` to its gutter, so the first pill lines up with its words and the row scrolls out to the edge (the guest menu, 5 November 2026). The chosen pill's fill carries `shadow-md`, lifting it a little off the ground as checklabs' chosen category does, and a pressed pill eases down to `--scale-press` on `--ease-press` (1 in the app, where nothing shrinks; the guest menu sets checklabs' 0.94 and its overshoot; none under reduced motion). Why a variant: the menu shows one category at a time, which is a tablist with panels (arrow keys move the choice); SectionTabs is links to places on one long page, and SegmentedControl is a radio group with no panels.
- `variant="topbar"` is a module's own tabs inside its TopBar (`TopBar`'s `tabs`, Bookings' Meetings · Pages · Availability · Routing, 9 November 2026): the bar's height, no hairline of its own, the underline on the TopBar's, so the page has one header and one line under it (the owner: "no double line under the module tabs"). Each tab is its own address, so it takes no panels: the page under the bar is the chosen tab's. On a narrow bar the row scrolls inside itself and fades at its ends, as the strip does. Why a variant: the `bar` variant is a second bar with its own hairline under the TopBar, which is the double line. Its arrows move focus and Enter or Space opens a tab (manual activation), so passing over a tab never loads its page. Without panels, the tabs drop React Aria's `aria-controls`, which would name a panel that isn't there.
- `placement="bottom"` draws the tabs under their panels (the marketing site's showcase: the screen first, the four areas under it, the owner, 23 October 2026). The markup order stays tabs then panels, so the keyboard and screen readers meet the tabs first; only the drawing moves (`order`). Why a variant: a feature row reads as a caption under the screen it names.
- `inset="none"` (for the strip; the bar keeps its own padding) drops the strip's 16px inset at both ends, for a full width strip outside a settings page (a settings page gets the page edge, below, without asking), so the first tab's label lines up with the full width Table's first column under it, and the tools end at the table's edge (Members and Invitations). The tabs keep their whole width, so on a phone a lone search wraps to a row under them rather than squeezing the last tab. Why a variant: the inset a record panel's tabs need from the panel's edge pushed the labels 24px in from the table's text (owner feedback, 21 October 2026).
- Directly in a settings page's body (SettingsLayout, which sets the library's page edge) a strip needs neither: it runs out through the page's gutter to its edges, the bar's height, its first label on the content edge where the body's headings and table text start, so every settings page gets it without asking (22 October 2026). Like the bar, it stays pinned at the top of the view while the page scrolls under it, the settings tabs matching Bookings' second bar (22 October 2026). Inside a Card, Modal, Popover or Panel the strip keeps its own inset.
- `end` puts the chosen tab's own tools at the far end of the strip, on its hairline: Captures' search, Bookings' week and its arrows (LinkListToolbar at `size="sm"`). The tabs keep their place; when both don't fit (a phone), the tools wrap to a row of their own under the tabs and shrink to the width, so the tabs are never squeezed. An `end` with nothing in it yet (every child empty, as a tab with no tools leaves its portal slot, a form's Settings) takes no room, so on a phone it never wraps under the tabs as an empty band (lane 3c, bookings lane O). Under the 700px page breakpoint, in the `bar` variant, the end's parts line up with each other's first line rather than their middles, with space-6 above and below: a slot of several tools that wraps to two lines inside itself (Bookings › Availability's Working hours and My schedules) keeps the control beside it (My hours · Roster) level with its first line, not floating between the two (5 November 2026).
- `alert` on a tab draws a small danger dot after its label and says its text to screen readers ("Meeting, needs a fix"): a field on that tab holds an error the person can't see from the tab they are on. Why: the booking page editor splits its fields across tabs, so an error on another tab was invisible (the owner, 22 October 2026). The dot is never the only cue; the field itself says the error once its tab is open.
- `TabPanel variant="fields"` stacks the panel's content `space-16` apart, as a Form stacks its fields, `space-16` under the strip, at most `size-column-max` wide from the start edge (so a Select sits near its label and nothing stretches across a wide page), for a tab of fields with no Card around them (the booking page editor). Why a variant: a panel lays out nothing, so its fields sat flush.
- `TabPanel variant="fill"` makes the panel a flex column, so a page layout inside it (PreviewLayout in the Captures editors, under a `bar`) fills the view's height and its SaveBar sits at the view's foot. Why: a panel lays out nothing, so the layout inside stopped at its content and the bar floated mid page. The panel, and the tabs with it, also grow with what they hold, so a `bar` stays stuck at the top of the view however far the page scrolls (held to the view's height, the panel overflowed the tabs' box and the bar scrolled away after a screen, 4 November 2026). Under a `bar`, the tabs set `--sticky-top` (and `--sticky-top-gap`, a gutter more) for what sticks inside the panel: QuestionList's header, PreviewLayout's preview.
- Only one panel shows at a time; use Disclosure for sections that can all be open.
- When each tab is a page of its own, give each its `href`. It doesn't navigate (the page's `onSelectionChange` does); it marks the tab with `data-href`, so the app loads that page while a pointer rests on the tab.

## States

- Tabs past the bar's end (a phone) fade at that end, and at the start once scrolled, over space-24, as a scrollable Table's frame does (`useScrollEdges`), so the row shows it scrolls (QA, 22 October 2026).

Chosen (text over the accent line), hover (pointer only), focus, disabled, with an alert dot. The line slides over `duration-fast` on `ease-smooth-out` for a pointer, and jumps for the keyboard and under reduced motion.

## Keyboard

The arrow keys move between tabs and choose; Home and End jump; Tab moves into the panel.

## Differences from the artifact

- `tabs` keep `id`, `label`, `icon` and `count`; panels are `TabPanel` children rather than rendered by the caller beside the bar.

## Timefix prototype (spec 0072)

Takes its look from the prototype's Tabs: `size-control-lg` tabs, `space-8` in, labels in `text-body-strong`, `text-secondary` at rest and `text` when hovered or chosen, the colour changing over `duration-fast` on `ease-smooth-out`, over the strip's `border-subtle` hairline. The chosen tab's line is 2px of `accent` with round ends (transitions.dev 16, tabs sliding, drawn as an underline: `duration-fast`, `ease-smooth-out`). Focus is the outline ring drawn `space-4` inside the tab, clear of the scroller; a focused panel gets the ring just inside its edge.

**Two looks until the guest phases (spec 0072, decision 16).** Guests draw Tabs too (a booking, menu or reservation page), and guest pages keep their shipped look and cost until their own port phase (6 to 8). So `Tabs.module.css` is the shipped look, which every page loads, and the prototype's look described here is `Tabs.app.css`: the module's own class names, in the `utilities.app-look` layer, only under `<html data-scale="app">`, loaded by `src/app-look.ts` from the app's layouts and the stories. Change the app's look there, and the shipped look in the module; `app-look.test.ts` keeps their class names in step.

**Use it for** sections of one page: a record's Overview, Activity, Notes; a booking page's settings; Upcoming and Past. **Don't use it for** switching how the same data is drawn (SegmentedControl) or moving between pages of the app (the sidebar).

**States**: rest, hover, chosen, focus visible, disabled, with an alert dot; the label keeps its weight when chosen, so nothing shifts.

**Differences from the prototype**
- The line is `accent`, as the prototype's; it was the text colour before spec 0072. `pills`' fill stays the ink (`text`), the guest menu's look.
- `pills`: once the fill has slid under the chosen pill (after `duration-fast`), the pill takes the same fill as its own background; a pill that loses it drops it at once, so the sliding indicator is what leaves. A contrast check reads a label's own ground, never an absolutely placed sibling's, so WebKit's axe read the white words on the page (MenuList's sections). Moved by the keyboard, the fill is there at once. The focus ring is the outline, 2px outside the pill.
- Kept beyond the prototype: the `bar`, `topbar`, `feature` and `pills` variants, `end` tools, `inset`, `placement`, the edge fades of a scrolling strip, `alert` dots, `href` tabs and the panel variants `fill` and `fields`. The feature variant's quiet labels moved from `text-tertiary` to `text-secondary`, the prototype's rest colour.
- SectionTabs (a page's pills of anchor links, a `nav` rather than a tablist) is folded into this part: it takes the `pills` look and lists what it repeats.
