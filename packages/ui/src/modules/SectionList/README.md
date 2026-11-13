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
- `title` is a heading one level under the heading around the list (an `h3` under a SettingsSection's `h2`), drawn by the list rather than the Card, so a chevron can stand before it and quiet words after it. A section with no title draws no header unless it has a grip or actions; its grip and what a move says name it by its place ("Section 2"), so a list of several sections should title each one.
- `actions` sit at the header's end and are always there: the section's menu with Move up and Move down, the single pointer way to move it (WCAG 2.5.7) and the way a screen's own announcement says.
- `quietActions` sit before them, after the grip, and wait with the grip for the pointer or focus, so a list of sections stays calm (6 November 2026). Where there is no hover they just stand there; a screen short of room leaves them out and offers the same in `actions`' menu.
- `isTitleInset` starts every title on the column a `density="media"` LinkList's tiles start on, a chevron or nothing in the column before it, so a title, its rows and its sub sections read down one edge.
- `variant="groups"` draws sections as a heading and rows parted by a hairline, no frame, for sections inside a section's Card (a menu's sub sections), so a card never holds a card. Each list's own headings sit a level under the Card's title that holds them.
- `isTitleLoading` draws a Skeleton where the title goes, so a loading head keeps its height.
- `emptyState` shows with no sections at all.
- The list is an `ol`: its order is what it says. Its sections stack 16px apart, as a settings section's cards do.

## States

- Sections that move (the default with `onMove`): a grip in each header, hover and focus as DragHandle's, the section being moved lifted (`shadow-md`) above the others, which slide out of its way, then the grip focused again where it landed.
- One section, or read only (no `onMove`): no grips. With no title and no actions, a plain Card.
- Empty: `emptyState`.
- Loading, failed and no access are the content's, as with Card: a screen draws a Card holding its LinkList's `status` (skeleton rows, the failure with Try again, the locked state) until its sections are known.
- On a phone the cards keep their headers; a LinkList inside takes its narrow card layout.

## Keyboard

Tab reaches each section's fold (its title) when it folds, then its grip, its quiet actions and its menu, then what it holds (a LinkList takes one tab stop, its rows by the arrows), then the next section. Quiet controls show as focus reaches the head. A folded section's contents leave the tab order; focus stays on the fold. On a grip, Enter or Space lifts the section: focus waits on the move itself, the arrow keys move it past the next section, Enter or Space drops it and Escape puts it back, each step said ("Sales, moved to position 2 of 3."), and focus comes back to its grip.

## Differences from the artifact

Not in the artifact yet.

- `description` puts a line under a section's title, the Card's own (a menu section's "5 items", after checklabs' category card, 5 November 2026).
- A section's `isExpanded` with `onExpandedChange` folds it: the title and a chevron before it are one disclosure button named by the title, read as expanded or collapsed. The chevron turns as it opens, what the section holds slides shut over `duration-move`, then leaves the tab order (reduced motion: at once), and a folded section draws its header alone. The caller keeps which are open (UI state). Why a variant: a menu's Structure folds its categories as checklabs' editor does (5 November 2026), and a Disclosure inside the Card would repeat its title; Card itself never folds. The fold is a plain `button` in this module rather than the Button atom, as Card's pressable title and Disclosure's trigger are: it is a heading that presses, in the heading's own type, with no control's frame. The chevron moved from the header's end to before the title, where a fold is looked for (6 November 2026: at the end, drawn as a held button, it read as focused all the time).

## Timefix prototype (spec 0072)

Takes its look from SettingsLayout's sections (decision 14: its own module): a section's title is `text-body-lg-strong` (`text-body-strong` in the `groups` variant), its count `text-label` in `text-tertiary`. Folding is the prototype's accordion (transitions.dev 21): the chevron turns and the body's height eases over `duration-fast` on `ease-smooth-out`. The fold's focus is the outline ring, `space-2` out. Repeats SettingsLayout's section title type, one rule, which leaves with this export when its last caller moves.

**Use it for** sections a person orders (a profile's booking pages, a menu's categories). **Don't use it for** settings sections that don't move (SettingsSection) or rows (LinkList, QuestionList).

**The consumer provides** `label`, `sections` (`id`, `title`, `description`, `actions`, `quietActions`, `content`, `isExpanded` with `onExpandedChange`, `isTitleLoading`), `onMove`, `variant`, `isTitleInset`, `emptyState`.

**States**: default, folding by pointer (`Folding`) and keyboard (`FoldByKeyboard`), moving by keyboard, row and menu, read only, narrow, title loading, empty.

**Differences from the prototype**: not a part of the prototype; reordering, the grip and the `groups` variant are the library's own.
