# SectionList

Titled sections in an order that matters, each a Card, that move as wholes, while what each one holds keeps its own order inside it.

## Why it exists

New (owner ask A102, 23 October 2026): Settings › Profile arranges the Public booking pages a person's profile (`/<handle>`) lists under its small section headings. A visitor sees the sections in the order of their first pages, so the person moves a page within its section, or a whole section, and nothing else.

- Card can't move: it is a frame with a header, and giving it a grip and a place in a sorting list would put drag code in every card.
- Sidebar's NavSection moves its sections (spec 0034), but it is navigation: a folding Disclosure with nav rows, whose section moves the sidebar drives by hand.
- Table, LinkList, QuestionList and OptionsEditor move rows, not groups of rows: a row moved there can land anywhere in the list, where a profile's page has to stay inside its section (another section is the page editor's Section field).

So SectionList is one sorting list (the library's drag wrapper) whose items are Cards: each section's grip and the caller's menu at the end of its header. What a section holds is the caller's; a profile's sections hold a LinkList whose own grips move its rows within that section only, since each list sorts in a drag area of its own.

## Use

```tsx
<SectionList
  label="Sections on your profile"
  sections={groups.map((group) => ({
    id: `section:${group.key}`,
    title: group.title ?? 'No section',
    actions: <MenuTrigger>…Move up, Move down…</MenuTrigger>,
    content: (
      <LinkList density="compact" placement="card" isToolbarHidden rows={rowsOf(group)} onMove={moveRow} … />
    ),
  }))}
  onMove={(id, toIndex) => moveSection(id, toIndex)}
  emptyState={<EmptyState title="No pages on your profile yet">…</EmptyState>}
/>
```

- `onMove` is called with the section's id and its new index once it is dropped (by pointer, or Enter or Space on its grip, the arrows, then Enter or Space). Left out, or with one section, the sections draw no grips.
- `title` is the Card's title, one level under the heading around the list (an `h3` under a SettingsSection's `h2`). A section with no title draws no header unless it has a grip or actions; its grip and what a move says name it by its place ("Section 2"), so a list of several sections should title each one.
- `actions` sit after the grip at the header's end: the section's menu with Move up and Move down, the single pointer way to move it (WCAG 2.5.7) and the way a screen's own announcement says.
- `emptyState` shows with no sections at all.
- The list is an `ol`: its order is what it says. Its sections stack 16px apart, as a settings section's cards do.

## States

- Sections that move (the default with `onMove`): a grip in each header, hover and focus as DragHandle's, the section being moved lifted (`shadow-md`) above the others, which slide out of its way, then the grip focused again where it landed.
- One section, or read only (no `onMove`): no grips. With no title and no actions, a plain Card.
- Empty: `emptyState`.
- Loading, failed and no access are the content's, as with Card: a screen draws a Card holding its LinkList's `status` (skeleton rows, the failure with Try again, the locked state) until its sections are known.
- On a phone the cards keep their headers; a LinkList inside takes its narrow card layout.

## Keyboard

Tab reaches each section's grip, then its menu, then what it holds (a LinkList takes one tab stop, its rows by the arrows), then the next section. On a grip, Enter or Space lifts the section: focus waits on the move itself, the arrow keys move it past the next section, Enter or Space drops it and Escape puts it back, each step said ("Sales, moved to position 2 of 3."), and focus comes back to its grip.

## Differences from the artifact

Not in the artifact yet.
