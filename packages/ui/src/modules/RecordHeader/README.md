# RecordHeader

The head of a record's page: its avatar, name and object, who else is viewing it, and its actions.

## Why it exists

New. Every record page (#17) and the people and company pages (#26) open with the same header. It composes atoms that exist (`Avatar`, `AvatarStack`) with the page's own buttons; `TopBar` is the bar above it, holding the crumbs and the page's h1.

## Use

```tsx
<RecordHeader
  record={company}
  objectName="Company"
  meta={<LinkChip href={company.domainHref}>{company.domain}</LinkChip>}
  viewers={presence}
>
  <Button variant="ghost" icon="star" label="Add to favorites" />
  <RecordMenu />
</RecordHeader>
```

- `record` is the record's display shape. A person's avatar is a circle; companies and other records are squares.
- The name is the page's second level heading: the `TopBar` above holds the h1 (as the crumbs' current place).
- `meta` follows the object name on the label line: a domain, a job title.
- `viewers` are the others with the record open (presence, #26), read as "Also viewing Grace Hopper and Alan Turing".
- `isLoading` shows skeletons after the loading delay. Below 480px wide the actions wrap under the name.
- The avatar is 48px (`Avatar` size `title`), so the record reads at a glance (13 Oct reference batch 4).
- `stats` draws the stat strip (`RecordStats`) on its own line under the header: counts and the last activity, each opening where it comes from (its tab).

## States

Default (with stats), a person (its read only name), loading, stats loading, without stats, with and without viewers, narrow (stats wrap), and the keyboard order (KeyboardOrder).

## Keyboard

Nothing of its own: Tab reaches the meta's link, the actions, then each stat that goes somewhere.

## Differences from the artifact

The artifact's record page draws a static header; this one adds presence and the loading state.

## Timefix prototype (spec 0072)

Takes its look from the prototype's RecordHeader: body type; the avatar `space-12` from the name; the name in `text-title-lg` (the prototype's `600 22px/30px` snapped to the nearest type token) over the sub line in `text-body-sm` and `text-secondary` (the object, then `meta`, `space-8` apart); the actions at the end `space-6` apart; the stat strip `space-12` under the top row (the prototype's gap between its rows). The loading skeleton lines take the same type, so nothing moves when the record lands.

**Use it for** the top of a full record page and the head of an expanded record. **Don't use it for** the peek drawer (RecordPanel has its own compact header) or a list row (PersonLine, RecordChip).

**The consumer provides** `record`, `objectName`, `meta` (the sub line's detail), `viewers`, the actions as `children` (favourite, Ask AI, email, the "…" menu, in the library's Button and Menu), `stats` and `isLoading`.

**States**: a read only name (Default, Person), loading (Loading, StatsLoading), with and without stats, viewers, narrow; the actions' own states (pressed, open) belong to the buttons the consumer passes.

**Interaction**: none of its own: Tab reaches the meta's link, the actions, then each stat that goes somewhere (KeyboardOrder).

**Differences from the prototype**

- The avatar stays 48px (`Avatar` size `title`, `size-toolbar`); the prototype's is 44px (`size-avatar-lg`). The size is a prop the header passes in code, not CSS, so it is owed to the record page's screen phase.
- Props differ: `record` (with its `kind`) for `name`, `kind` and `src`; `objectName` and `meta` for `sub`; the actions are `children` rather than `onAskAI`, `onStarChange`, `onEmail`, `moreActions` and `onMore`; the prototype's `tags`, `stage` and `position` ("7 of 70" with K and J) are drawn by the record page around it.
- Not built (each needs a new prop, owed to the record page's screen phase): rename in place (press the name, Enter saves, Esc cancels), the star's icon swap, the stage's status field and the position control with its rolling count.
- Kept beyond the prototype: who else is viewing (`viewers`), the loading skeletons, the stat strip (`stats`) and the narrow wrap below 480px.
