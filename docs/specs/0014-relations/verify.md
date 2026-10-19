# 0014. Relations: verify

How each milestone was checked, and the numbers measured. The owner waived the million record seed (12 October 2026), so budgets that name the scale seed are measured on a smoke seed and said so.

## Milestone 2: link from the table

### The record search (AC-289), on a smoke seed

`SEED_SCALE_RECORDS=50000 SEED_SCALE_ENTRIES=0 node scripts/seed-scale.ts` on the local Docker Postgres (database `crm_rel2`): 20,000 companies and 50,000 deals in one workspace, sort keys rebuilt. Each query ran 40 times through `searchRecords` (the whole call: its transaction, the search, the displays), on a laptop, 19 October 2026.

| Object | Query | Mode | Results | p95 (ms) |
|---|---|---|---|---|
| Companies (20,000) | empty | recent | 20 | 93 |
| Companies | `c` | prefix | 20 | 119 |
| Companies | `co` | prefix | 20 | 157 |
| Companies | `com` | contains | 20 | 78 |
| Companies | `ltd` | contains | 0 | 16 |
| Companies | `zzq` | contains | 0 | 50 |
| Deals (50,000) | empty | recent | 20 | 25 |
| Deals | `c` | prefix | 20 | 58 |
| Deals | `co` | prefix | 0 | 17 |

All inside the 300 ms read budget at p95. The million record figure is waived with the seed.

**The prefix plan**: `explain (analyze, buffers)` of the prefix statement for `co` on Companies is an `Index Scan using sort_keys_text` whose `Index Cond` holds both bounds (`text_key >= 'co'` and `text_key < 'co' || U+FFFF`, collated `und-x-icu`), then an index only probe of `records_live` per row: 20 rows, 71 shared buffers, 0.4 ms. No filter step reads past the range. `link-delta.test.ts` checks the same shape on every run (index scan on `sort_keys_text`, both bounds in the index condition).

### Not measured yet

- The worst page (AC-288: the hub and 99 companies of 2,000 people each, 100 companies a page) and adding a person to the 150,000 person hub (AC-290's 250 ms edit budget) need the hub fixture on the scale seed, which this milestone didn't build. The engine's reads and writes are unchanged in shape for them (`linkValues` keeps its lateral `limit 21` and counts only cut cells; `writeLinksDelta` reads only the named records and the side's last position), so cells keep exact totals until the measure says otherwise.
- The Playwright flow `links.flow.ts` passed once at 1280 wide against the app on port 5273 with live updates off (16 October 2026); it joins CI's `flows` job and runs with the batch.
