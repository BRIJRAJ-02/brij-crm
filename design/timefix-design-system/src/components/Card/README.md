Cards hold one block of related content on a white surface; a `Shell` groups related cards in a tinted frame, `StatCard` shows a number that matters, and `TileGrid` turns cards into a pick-one choice.

**Use it for**: dashboards and record overviews (`StatCard`s in a `Shell`), side blocks such as "Up next" (`Card` with a `CardLink`), and visual choices like a meeting location, a page template or a plan (`TileGrid`). **Don't use it for**: list rows (use rows), settings (use `SettingsSection`), or more than about eight choices (use a select).

**The consumer provides**: `Card` `title`, grey `description`, `action`, `flush`; `Shell` `title`, `action`, `columns`; `StatCard` `label`, 16px `icon`, `value` (undefined while loading), `format`, `delta` (`value`, `direction`, `note`, `isGood`), `sparkline` points or `breakdown` rows (`label`, `share`, `hue`); `TileGrid` `label`, `items` (`id`, `title`, `description`, `meta`, `icon`, `isDisabled`), `value` and `onChange`, `columns`, `variant` (`default` stacked, `compact` one 52px row with the icon well first, for a meeting location), and `onAction` for tiles that start something (a template gallery: buttons, no selected state).

**States**: stat loading ("—", a dotted placeholder line, empty bars, no layout shift), delta good (green) or bad (red); tile rest, hover, selected (accent edge, tinted icon, check badge), focus-visible, disabled; action tiles lift a hairline shadow on hover.

**Interaction**: a stat's changed digits rise into place with a fade (transitions.dev 02, number pop-in) on mount and whenever the period changes. `CardLink`'s chevron slides 2px and opens 8° into an arrow over 350ms (24, learn more hover). Tiles are one radio group: arrows move and select, and the check badge pops in on the bounce curve (03's pop).

**Replaces**: Card, Stats, RecordStats, TileGrid.
