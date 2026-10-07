# 0021. Board view: decision record

## Context

Pipelines are the most common way people work deals and projects in a CRM: columns by stage, cards moved left to right. The scope's "done when" for #21: dragging a card writes the attribute and moves it live for everyone; a read only field can't be dragged; each view chooses its card fields; empty columns can be shown or hidden.

The pieces exist. The library has a Board module with keyboard and screen reader drag and drop, per column card sources, archived columns and hidden empty columns (spec 0003). Saved views (spec 0020) carry a `board` section in their config. The client data layer (spec 0006) has windows, settle, optimistic writes, undo and the replaced notice. Status options carry a target time in stage (spec 0004), stored and never shown so far.

The open questions are about ordering and loading. A column can hold 150,000 records on the scale seed, so a column must page. Order inside a column could be hand made (a rank) or follow the view's sorts. A board has many columns, so its first load could be one request per column, or one for all. And when someone else moves a card, the board must decide whether to wait for the server or move it at once.

Forces: the scale budget (read 300 ms, edit 250 ms at p95, 100 online); live within a second; one write path for values (house rules); the brief's "no manual ranks", "first page 25 plus capped counts", "optimistic drag to top"; Neon's free plan (no timers).

## Options considered

### Option 1: columns as windows, ordered by the view's sorts, batched first load (chosen)

Each column is a spec 0006 window over "view filter and this option". The first page of up to 12 columns comes from one `records.groups` call; later pages per column by cursor. A move is a normal value write; others' moves are placed by option id at once and settle shortly after.

**Pros**: no new storage and no new write path; every value rule (history, undo, clashes, access) applies to moves; columns scale like tables; one round trip paints an ordinary pipeline.
**Cons**: no hand made order; a board of 50 columns needs 5 sequential calls; a card placed by option id sits at the top of its column until the settle.

### Option 2: hand made order with a rank per card per board

Store a rank (a fractional index) per record per board view, so cards keep the order people drag them into.

**Pros**: familiar from task boards; dragging within a column means something.
**Cons**: a second ordering system next to sorts; a rank row per record per board (a million records times every board view); new records need a rank rule; ranks of hidden records leak order; every drag becomes two writes. The brief rejected it.

### Option 3: one request per column, no batched call

Each column opens its own window with `records.query` and `records.count`, no new procedure.

**Pros**: no new procedure; columns load independently.
**Cons**: a 10 column board opens with 20 requests at once per member, which at 100 members multiplies the read load the budget assumes; columns pop in one by one.

### Option 4: load the whole board in the browser and group there

Read the view's records and split them into columns locally.

**Pros**: trivially consistent columns.
**Cons**: impossible at a million records; breaks the rule that ordering and filtering stay on the server.

## Rationale

Option 1 meets every force with the parts already built. Sorting cards by the view's sorts keeps one ordering model across tables and boards, which matters more in a CRM (sort by close date, by value) than a hand made order, and the brief chose it. Treating columns as windows means a stage with 150,000 deals is no different from a filtered table, a case spec 0006 already proves at a million records. The batched first call is the cheap middle between Option 3's request fan out and Option 4's impossibility: one round trip for the common board, then each column on its own.

Placing others' moves by option id breaks, in one narrow place, spec 0006's rule that the browser never decides membership. It is safe because the column condition is an exact equality on a value the store holds after the refetch, and it makes a teammate's move visible within the one second target instead of after a settle. The rest of the filter is still decided by the server at settle.

Calls and their runners up:
- **"No <attribute>" first** (runner up: last). Records without a stage are usually new and belong where work starts.
- **50 live options at most** (runner up: no limit). Past 50 the board is unreadable, and the first load can't meet the budget.
- **Stuck badge computed in the browser** (runner up: a server flag refreshed by a job). The browser already has the stage start time and the target; a job would wake the database on a timer.
- **Show empty columns on by default** (runner up: off). A pipeline with a hidden stage misleads more than a sparse one.
- **Multi select excluded** (runner up: a card shown in every column of its values). A move would then be ambiguous (which value does it replace?).

## References

**Project sources**:
- Spec 0003's board (`0003-charts-board-and-schema-map.md`) and `packages/ui/src/modules/Board/README.md`, `types.ts`.
- Spec 0004 (status options, `target_time_in_stage`, value versions, `getTimeInStages`) and its stored sort keys (`sort_keys` with the live flag).
- Spec 0006 (windows, settle, own rows, undo, the replaced notice).
- Spec 0009 (`readOnly` reasons, field `write`).
- Spec 0020 (`views`, `BoardConfig`, drafts, lock rules).
- `.claude/skills/crm-frontend-state`, `crm-design-system`.

**Practices and standards**:
- Cursor pagination per group instead of offset.
- Optimistic updates with rollback; last write wins with a notice.
- WAI-ARIA accessible drag and drop through React Aria.
