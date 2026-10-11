# 0011. Verify

What each milestone proved, as printed, with every miss named and either fixed or given a plan (AC-213).

## Milestone 2: reads and writes against the budget (12 October 2026)

### Where it ran

The reference machine (MacBookPro18,3, M1 Pro, 8 cores, 16 GB), with Docker Desktop at 8 CPUs and **7.75 GB**, below the 11 GB `pnpm load:stack` asks for. So the load stack's data services and then its API and worker were started with `docker compose -f docker-compose.load.yml -p crm-load up` directly (the caps are ceilings, and the `smoke` seed is small), and seeded with `pnpm load:seed --profile smoke` (50,000 records, 50 users; it seeds, then refuses at the end on the memory check, as it should). Two other build lanes were running their test suites on the same machine, so absolute times are noisy.

The `smoke` seed has 50 users, so these runs are 50 users for 2 measured minutes, not the gate's 100 for 10. **The gate runs (`crm` seed, 100 users, 10 minutes) are an owner step** once Docker has 12 GB.

### steady, 50 users, 2 minutes, smoke seed

```
metric                                 target              p50    p95     p99     max  count  verdict
read (scroll, filter or sort windows)  p95 ≤ 300 ms       49.9  293.9  1632.2  2919.4    872  PASS
open a record                          p95 ≤ 200 ms       18.3  275.8  1247.0  1358.7    119  MISS
edit                                   p95 ≤ 250 ms       29.5  395.6  2455.0  3260.2    142  MISS
create                                 p95 ≤ 300 ms       44.8  433.0  1354.9  1354.9     35  MISS
read by position                                          38.7  205.5   467.3  2418.2    383  REPORTED
read by cursor                                            61.1  356.6  2050.2  2919.4    489  REPORTED
count                                                     31.9  207.2  1077.3  2370.4    177  REPORTED  (not judged)
live delivery                          p95 ≤ 1000 ms                                          NOT BUILT YET  (milestone 3)
API pool wait                          p95 ≤ 50 ms         0.0    0.2   181.2  1499.8   1840  PASS
pooler wait (PgBouncer maxwait)        p95 ≤ 50 ms         0.0    0.0     0.0     0.0     24  PASS
Postgres CPU                           p95 ≤ 70%          12.3   33.3    80.3    80.3     24  PASS
relay lag                              p95 ≤ 250 ms                                           NOT BUILT YET  (milestone 3)
unexpected errors                      ≤ 0.1% of actions                                  17  MISS  (1.248% of 1362 actions)
429 too many requests                                                                     17  REPORTED
counts aborted by a newer view                                                             2  REPORTED

mix achieved: scroll 60.1%, filterSort 14.9%, open 10.1%, edit 12.0%, create 3.0% (largest gap 0.11 points)
actions: 1182 sent of 1182 planned; event loop p99 15.9 ms, 15.7 ms
WAL written: 9.7 MB
INVALID (exit 2): unexpected errors were 1.248% of actions (limit 0.1%): 429 TOO_MANY_REQUESTS ×17.
```

### spread, 50 users, 2 minutes, smoke seed

```
metric                                 target              p50    p95     p99     max  count  verdict
read (scroll, filter or sort windows)  p95 ≤ 300 ms       61.0  412.5  1772.6  4370.4    863  MISS
open a record                          p95 ≤ 200 ms       22.9  173.6   276.6   324.5    115  PASS
edit                                   p95 ≤ 250 ms       38.2  431.1   494.1   574.0    139  MISS
create                                 p95 ≤ 300 ms       52.3  344.9   615.4   615.4     36  MISS
read by position                                          51.3  271.3   461.3   669.3    390  REPORTED
read by cursor                                            70.6  544.7  2417.4  4370.4    473  REPORTED
count                                                     38.5  226.0   332.2   553.2    173  REPORTED  (not judged)
API pool wait                          p95 ≤ 50 ms         0.0    0.1    15.0   157.5   2071  PASS
pooler wait (PgBouncer maxwait)        p95 ≤ 50 ms         0.0    0.0     0.0     0.0     24  PASS
Postgres CPU                           p95 ≤ 70%          14.8   50.5    69.2    69.2     24  PASS
unexpected errors                      ≤ 0.1% of actions                                   9  MISS  (0.674% of 1335 actions)

mix achieved: scroll 60.0%, filterSort 15.0%, open 9.9%, edit 12.0%, create 3.1% (largest gap 0.10 points)
actions: 1160 sent of 1160 planned; event loop p99 15.5 ms, 15.8 ms
WAL written: 9.6 MB
INVALID (exit 2): unexpected errors were 0.674% of actions (limit 0.1%): 429 TOO_MANY_REQUESTS ×9.
```

The top statements of both runs were the value read behind every window (`select "position", "text_value", …`, 1.8 to 2.6 ms mean), the search function behind `contains` filters (8 to 11 ms mean), the sort key seeks of name sorted views, and the `created_at` sorted owner filter (28 to 47 ms mean).

### The run judging itself

| Check | How | Result |
|---|---|---|
| A stalled harness is invalid (AC-203) | `LOAD_TEST_BLOCK_LOOP_MS=80 node packages/load/scripts/run.ts steady --users 5 --minutes 1` | `INVALID (exit 2): the harness couldn't keep up: an event loop stalled 136.3 ms at p99 (limit 50 ms)` |
| Errors past 0.1% are invalid (AC-203) | the API stopped 30 seconds into the measured window (`docker compose … stop api`) | `INVALID (exit 2): unexpected errors were 55.814% of actions (limit 0.1%): dropped ×48` |
| An expired session refuses before the warm up (AC-196) | user 1's session row expired by hand | `User 1's session was refused. Mint the sessions again: pnpm load:sessions.` (exit 3); `pnpm load:sessions` minted them again |
| Reset gives the slots back (AC-209) | `pnpm load:reset` after the runs | `Erased 52 records the harness made. 49,481 live records, 950,519 free slots.` (the seed's own live count) |

### Misses and their plans

1. **429 `TOO_MANY_REQUESTS` at 50 users, in both gates.** Spec 0005's read gate lets 6 `records.query` and `records.count` calls run at once per workspace per API process, and one workspace with 50 people passes it: a filter or sort sends its window and its count together, and a cursor jump reads forward in up to 50 sequential calls. A person would see these refusals, so the run is invalid, and at 100 users it will be worse. Plan (#41): size the gate to the budget (a per member limit inside a larger per workspace one, or a queue that waits briefly instead of refusing), and measure again; the harness keeps counting 429s as unexpected.
2. **open, edit and create p95 over target at 50 users, while their p50 is 18 to 52 ms.** The tail comes from the API: its pool wait is near zero at p95 but 157 to 181 ms at p99 and up to 1.5 s at the max (10 clients per API process behind PgBouncer's 20), and the API runs on 1 vCPU. Plan (#41): read the API's CPU beside Postgres's, try a larger API pool, and rerun at 100 users on the `crm` seed before changing anything.
3. **spread's reads over target (p95 412 ms), cursor reads above all (p95 545 ms, max 4.4 s).** Cold reads and long forward reads from a checkpoint (a jump anywhere in a filtered view reads 200 rows per call up to row 10,000). Plan (#41): judge on the `crm` seed first; if it holds, give cursor jumps a seek from a sort key (spec 0006's open question) rather than more forward calls.
4. **Postgres CPU's p99 reached 80% in steady** (its p95, the judged number, was 33%). Watched, not planned: one 5 second sample, while other lanes ran on the machine.

### Calls made in this milestone

- 0006 task 6 had landed (filter, sorts and `canJump`), so step 8 built nothing.
- A scroll moves 1 to 3 windows and reads each window it passes (by position, at once; by cursor, one after another); 20% of scrolls jump (`JUMP_SHARE`, a model choice, not a target).
- Filter or sort picks among each object's plain view, its name sort (both by position) and the spec's filtered shapes (by cursor).
- Windows read the columns on screen (the first 10 by position, plus what edits, filters and sorts need), as the People table does; an open reads the whole record.
- The mix follows a golden ratio sequence over the arrivals in time order, so it holds within a point even on short runs (independent draws drift several points on the weekly smoke's 480 actions).
- `db` in `Server-Timing` is the time the request held a database client (its queries and their round trips); `pool` is the time it waited for one, across the tenant and identity pools.
- `pg_stat_statements` is turned on by `pnpm load:seed` and `pnpm load:run` as the load stack's superuser inside its container (the extension, `pg_read_all_stats` and the reset for the owner login); off the load stack the statements line says it wasn't measured.
- Putting the hub's Team back (AC-209's second half) waits for the `hub` scenario in milestone 4, the first that moves people off it.

### Owner steps

- Raise Docker Desktop's memory to 12 GB, then `pnpm load:stack:wipe`, `pnpm load:seed` (the `crm` profile, up to an hour), `pnpm load:run steady` and `pnpm load:run spread`, and paste both tables here.
