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
- `meta` follows the object name on the label line: a badge, a lock.
- `facts` puts the record at a glance under its name in place of the object's name (heard, not drawn, since the crumbs say it): its key facts as `RecordFacts`, a person's job title, company, email and phone (owner, 31 October 2026: the header held only the avatar, the name and "Person"). Quick actions (Email, Call, Log activity, Add task) go in `children` with the record's menu.
- `viewers` are the others with the record open (presence, #26), read as "Also viewing Grace Hopper and Alan Turing".
- `isLoading` shows skeletons after the loading delay. Below 480px wide the actions wrap under the name.
- The avatar is 48px (`Avatar` size `title`), so the record reads at a glance (13 Oct reference batch 4).
- `stats` draws the stat strip (`RecordStats`) on its own line under the header: counts and the last activity, each opening where it comes from (its tab).

## States

Default (with stats), with facts, loading, stats loading, without stats, with and without viewers, narrow (stats wrap).

## Keyboard

Nothing of its own: Tab reaches the meta's link, the actions, then each stat that goes somewhere.

## Differences from the artifact

The artifact's record page draws a static header; this one adds presence and the loading state.
