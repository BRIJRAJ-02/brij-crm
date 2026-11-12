# RecordChip

A linked record, a member, or another actor as a chip with its avatar or icon.

## Why it exists

Ported from the artifact's RecordChip card. It is the one display for record references and actor references (members, API keys, automations, the system), in cells, the record panel, cards, the timeline and filters. Screens render it through the field set.

## Use

```tsx
<RecordChip display={{ objectId: 'companies', recordId: 'r1', name: 'Northwind', kind: 'company' }} href="/companies/r1" />
<RecordChip display={{ type: 'member', id: 'm1', name: 'Ada Lovelace' }} />
<RecordChip display={{ type: 'system', id: null, name: '' }} isFlat />
```

- `display` is the `RecordRefDisplay` or `ActorDisplay` the data layer (#6) builds; the chip never resolves an id.
- People get a circle avatar, companies and other records a square. API keys, automations and the system get their icon (key, zap, server), and the system always reads "System".
- `href` makes it a routed link to the record; it passes `safeHref()`.
- `isFlat` drops the edge for dense places.
- `isPlain` drops the edge and the fill: the avatar and the name as text, at the body's weight like the words around it, for who did something at the start of a line (the timeline's actor) and a member on a record's panel (its owner). Why a variant: in the activity feed the actor in a grey pill read heavier than what they did (the owner's call, 20 October 2026), and on the panel the framed chip at the strong weight read larger than the other values (21 October 2026). A linked plain chip still takes the hover fill.

## States

Hover and focus, when it links.

## Keyboard

When it links, Tab reaches it and Enter follows it.

## Differences from the artifact

- One `display` prop replaces `name`, `kind` and `color`, and actors are new.
- `isFlat` replaces `flat`.

## Timefix prototype (spec 0072)

Takes its look from the prototype's RecordChip: a 24px chip on the surface with a hairline edge, a 20px avatar 2px in from its start (round for people, square for companies) or an actor's icon, the name in `body-sm-strong`. A linked chip washes on hover (`surface-hover`, `border-strong`), darkens while pressed (`surface-selected`) and shows the outline ring on keys.

**Differences from the prototype**: `isFlat` and `isPlain` and the actor kinds (API key, automation, system) are kept. Links pass `safeHref`; a refused one renders a plain chip.
