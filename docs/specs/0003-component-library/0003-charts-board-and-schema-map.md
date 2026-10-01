# 0003 · Charts, the board, the dashboard and the schema map

## Summary

Charts are our own components built from visx's small SVG pieces, so they draw in token colours and change theme with no new render. The board and every reorderable list use React Aria's drag and drop, which works by keyboard and screen reader with no extra work. Dashboard tiles move by a drag handle or a Move menu. The schema map draws objects and their relationships on React Flow, laid out by ELK in a background worker.

## Versions (checked 2026-10-01)

| Package | Version | Fits |
|---|---|---|
| `@visx/scale`, `@visx/shape`, `@visx/axis`, `@visx/group`, `@visx/grid` | 4.0.0 line | React 18 and 19 (confirm each with `pnpm view` when pinning) |
| `@xyflow/react` | 12.12.0 | React 17 and up |
| `elkjs` | 0.12.0 | no peers; has a worker build and a main thread build |
| `react-aria-components` drag and drop | 1.21.1 | keyboard and screen reader drag and drop in GridList and Table |

`@visx/xychart` is left out on purpose: it brings an animation runtime (`@react-spring/web`), and our motion comes from CSS and tokens.

## Charts (`@crm/ui/charts`)

- **Components**: `BarChart` (vertical or horizontal; grouped or stacked), `LineChart` and `AreaChart` (over time), `NumberTile` and `ChartLegend`.
- **Data in**:

  ```ts
  interface ChartProps {
    title: string; description?: string;
    xAttribute: FieldAttribute;      // its type picks the scale: date or timestamp gives time, number gives linear, others give bands
    valueAttribute: FieldAttribute;  // what y means (count, currency, number), for labels and tooltips
    series: readonly { id: string; label: string; points: readonly { x: string | number; y: number; yText?: string }[] }[];
    status?: 'ready' | 'loading' | 'error' | 'no-access'; onRetry?(): void;
  }
  interface NumberTileProps { label: string; valueAttribute: FieldAttribute; value: AttributeValue | null; previous?: AttributeValue | null; period?: string; status?: ChartProps['status'] }
  ```

  Values arrive already aggregated by #52. `y` is a number for plotting only, and labels and tooltips use `yText` (the exact value formatted through the field set) when given. `NumberTile` shows the change against `previous` as a percentage with an arrow and words, never colour alone.
- **Colour and marks**: series `n` gets `data-series={n}`, and the module's CSS maps it to `fill` and `stroke` from the `dot-*` tokens in this order: blue, green, orange, purple, sky, yellow, red, lime, gray.
  - At most 9 series. From the 10th, series fold into "Other", in gray.
  - Each series also gets its own marker shape (lines) or pattern (bars), so colour isn't the only signal (WCAG 1.4.1), and the legend names every series.
  - Axes, grid lines and labels use `text-secondary` and `border-subtle`.
  - SVG reads CSS variables, so a theme change repaints with no React render. A test counts renders across a theme switch and expects zero.
- **Size**: each chart fills its container (a `ResizeObserver` gives the width), and dense labels thin out below `bp-container-sm` through container queries.
- **Access**:
  - Every chart has a `title`, a `description`, and a "View as table" toggle that renders the same data in `Table`.
  - Arrow keys move focus across bars or points, and each announces its series, x and formatted value.
  - A tooltip follows focus and the pointer alike.
- **States**: loading (the chart's frame with a skeleton), empty (`EmptyState`, "No data for this period"), error (with retry), and no access.

## The board

`Board` is a row of `KanbanColumn`s, each a React Aria `GridList` of `KanbanCard`s, with `Virtualizer` inside long columns.

```ts
interface BoardProps {
  label: string;
  columns: readonly {
    id: string; title: string; hue?: Hue; count: number;
    cards: ListSource<BoardCard>;            // loads more as the column scrolls
    isArchived?: boolean;                    // an archived option: shown if it has cards, never a drop target
  }[];
  isReorderable?: boolean;                   // default false: cards move only between columns
  onMove(move: { cardId: string; toColumnId: string; beforeCardId?: string }): void;
  showEmptyColumns: boolean;  onShowEmptyColumnsChange?(show: boolean): void;
  cardFields: readonly FieldAttribute[];     // which fields each card shows (#21's view settings)
}
```

- **Moving cards**: cards move between columns with `useDragAndDrop` (pointer, keyboard and screen reader).
  - Moving within a column is enabled only when `isReorderable` is set. A board grouped by a status or select has no stored order until #21 decides one, so `beforeCardId` is advisory.
  - A card whose grouping field is read only can't be dragged, and says why in a tooltip.
  - A drop onto an archived option's column is refused, with a message.
- **On a move**: the board calls `onMove`, and the data layer writes the attribute optimistically (#21).
- **Counts** come from the screen, since columns may hold more cards than are loaded.
- **Hidden columns**: empty columns hide when `showEmptyColumns` is false, and a "N hidden columns" chip shows them again.

## The dashboard

`Dashboard` is a CSS grid of `Card` tiles in three sizes (`sm` one column, `md` two, `lg` full width). It's a plain list of cards, not a `GridList`, so arrow keys stay free for the charts inside the tiles.
- **By keyboard**: each tile has a Move button with a menu: Move earlier, Move later, and Size (small, medium, large).
- **By pointer**: drag a tile by its handle only (React Aria `useDrag` and `useDrop`).
- **Layout changes** leave through `onLayoutChange(order, sizes)`, and #52 saves them.

## The schema map (`@crm/ui/schema-map`)

```ts
interface SchemaMapProps {
  objects: readonly { id: string; name: string; icon: ObjectIcon; hue: Hue; attributes: readonly { id: string; name: string; type: AttributeType }[] }[];
  relations: readonly { id: string; from: { objectId: string; attributeName: string }; to: { objectId: string; attributeName: string }; cardinality: 'one_to_one' | 'one_to_many' | 'many_to_many' }[];
  positions?: Readonly<Record<string, { x: number; y: number }>>; // saved positions, if #56 keeps them
  onObjectOpen?(objectId: string): void;
  onRelationOpen?(relationId: string): void;
  onConnect?(fromObjectId: string, toObjectId: string): void;    // #56 opens its create dialog
  canConnect: boolean;                                           // admins only, decided by the screen
}
```

- **Nodes**: each object is an `ObjectNode`, with its tile, its name, and its attributes grouped by type.
  - The width is fixed by a new token, `size-schema-node`, added to the artifact in milestone 5 through spec 0002's flow.
  - The height comes from the attribute count: up to 8 rows, then a "+N more" footer. So ELK knows every node's size before it lays them out, with no measuring pass.
- **Edges**: each relation is a `RelationEdge`, labelled with both attribute names and the cardinality (`1 · N`).
  - It draws ELK's routed `sections` (bend points) as its SVG path, and places its label where ELK computed it.
  - Self relations and parallel relations between the same pair use ELK's own handling.
  - A relation naming an unknown object id is dropped, with a warning in development.
- **Layout**: ELK's layered algorithm with orthogonal edges, so no nodes overlap.
  - In the app it runs in a module worker loaded as a real same origin file: `new Worker(new URL('./elk.worker.ts', import.meta.url), { type: 'module' })`. That's never an inlined `blob:` worker, which `script-src 'self'` blocks.
  - Nodes with saved `positions` are pinned, and ELK places only the others.
  - The first view uses `fitView`.
  - The artifact's preview, a single file bundle that can't carry a worker, uses elkjs's main thread build or fixed `positions`.
- **Connecting**: with `canConnect`, dragging from a node's handle to another node calls `onConnect`. The keyboard alternative is a "New relationship" button that opens a dialog to pick both objects, and it calls the same `onConnect`.
- **Keyboard**: Tab moves between nodes (React Flow 12's own node focus), Enter opens the focused object, and the node's menu lists its relations to open. Moving nodes by keyboard is turned off, since positions are ELK's or #56's.
- **Styling**: React Flow's `base.css` is imported into `@layer components` inside the module's CSS, and its CSS variables are mapped to tokens. The canvas uses `surface-subtle`, and nodes look like `Card`.
- **States**: loading (skeleton nodes), empty ("No objects yet"), and error.
- **Out of scope here**: live updates and saving positions are #56's. The component redraws from its props.
