# 0011. Verify

What each milestone proved, as printed, with every miss named and either fixed or given a plan (AC-213).

## Milestone 2: reads and writes against the budget (12 October 2026)

### Where it ran

The reference machine (MacBookPro18,3, M1 Pro, 8 cores, 16 GB), with Docker Desktop at 8 CPUs and **7.75 GB**, below the 11 GB `pnpm load:stack` asks for. So the load stack's data services and then its API and worker were started with `docker compose -f docker-compose.load.yml -p crm-load up` directly (the caps are ceilings, and the `smoke` seed is small), and seeded with `pnpm load:seed --profile smoke` (50,000 records, 50 users; it seeds, then refuses at the end on the memory check, as it should). Two other build lanes were running their test suites on the same machine, so absolute times are noisy.

The `smoke` seed has 50 users, so these runs are 50 users for 2 measured minutes, not the gate's 100 for 10. The gate runs on the `crm` seed (100 users, 10 minutes) were to be an owner step once Docker had 12 GB; **the owner waived them on 12 October 2026**, so these smoke runs stand.

### steady, 50 users, 2 minutes, smoke seed (after the reviews' fixes)

```
metric                                 target              p50     p95     p99     max  count  verdict
-------------------------------------  -----------------  ----  ------  ------  ------  -----  -------
read (scroll, filter or sort windows)  p95 ≤ 300 ms       53.4  1669.2  3158.0  4950.1    795  MISS
open a record                          p95 ≤ 200 ms       22.5  1828.9  2766.8  2825.7    117  MISS
edit                                   p95 ≤ 250 ms       37.4  2521.1  4026.2  4440.4    142  MISS
create                                 p95 ≤ 300 ms       40.6  3670.9  3814.4  3814.4     35  MISS  (only 35 samples: a direction, not a measure)
read by position                                          40.6  1088.1  2445.6  2837.9    324  REPORTED
read by cursor                                            69.7  1955.6  3799.7  4950.1    471  REPORTED
count                                                     33.7  1508.5  3396.3  3989.8    165  REPORTED  (not judged)
API handler time per request                              40.5  1405.8  2738.5  4354.6   1935  REPORTED  (Server-Timing app: the server side of every request)
live delivery                          p95 ≤ 1000 ms                                           NOT BUILT YET  (milestone 3: Centrifugo clients)
API pool wait                          p95 ≤ 50 ms         0.1   308.5   875.4  1604.0   1935  MISS
pooler wait (PgBouncer maxwait)        p95 ≤ 50 ms         0.0     0.0     0.0     0.0     24  PASS  (only 24 samples: a direction, not a measure)
Postgres CPU                           p95 ≤ 70%          14.1   105.8   130.4   130.4     24  MISS  (only 24 samples: a direction, not a measure)
API CPU                                                   24.9   111.2   147.7   147.7     24  REPORTED
relay lag                              p95 ≤ 250 ms                                            NOT BUILT YET  (milestone 3: the relay on the load stack)
unexpected errors                      ≤ 0.1% of actions                                  108  MISS  (9.184% of 1176 actions; over the limit the run is invalid)
expected refusals (409, 422)                                                                0  REPORTED
429 too many requests                                                                     108  REPORTED  (unexpected: a person would see this refusal)
counts aborted by a newer view                                                              0  REPORTED

scenario steady (gate), 50 users, 2 measured minutes after 60 s of warm up, seed 12
run 2026-10-11T20:55:57.486Z to 2026-10-11T20:59:03.497Z, git 86eeed875801b98e508b38886185fac7cde69be9, API http://localhost:3100, 1 thread(s)
host MacBookPro18,3, 8 cores, 16.0 GB; Docker 8 CPUs, 7.7 GB
stack caps: api 1 CPU/1.0 GB, centrifugo 1 CPU/0.5 GB, mailpit uncapped/0.0 GB, pgbouncer uncapped/0.0 GB, postgres 2 CPU/8.0 GB, worker 1 CPU/0.5 GB
database clock offset: -32.8 ms
manifest (smoke): deals 12,374 live of 12,500, companies 7,424 live of 7,500, people 29,683 live of 30,000
mix achieved: scroll 59.9%, filterSort 15.1%, open 9.9%, edit 12.1%, create 3.0% (largest gap 0.07 points)
actions: 1176 sent of 1176 planned; event loop p99 19.7 ms, 25.7 ms
WAL written: 10.5 MB
unexpected errors: 429 TOO_MANY_REQUESTS ×108
top statements by total time:
      6306 ms       73 calls     86.38 ms mean  select r.id::text as id, r.id::text as record_id, r.created_at::text as key0 from records r where r.object_id = $1 and r.deleted_at is null and (exists (select 
      6089 ms      142 calls     42.88 ms mean  with c0 as materialized ( select d.owner_id as id_, d.workspace_id as ws_, d.code_key as dkey0_, d.number_key as dkey1_ from sort_keys d where d.attribute_id = 
      5455 ms     1350 calls      4.04 ms mean  select "position", "text_value", "number_value"::text, "date_value"::text, to_char("timestamp_value" at time zone $1, $2), "bool_value", "option_id", "actor_typ
      3820 ms      317 calls     12.05 ms mean  select count(*)::int as n, case when count(*) < $1 then array_agg(id::text) end as ids from crm_search_text($2::uuid, $3, $4::int) as id
      3259 ms       25 calls    130.37 ms mean  select r.id::text as id, r.id::text as record_id, r.created_at::text as key0 from records r where r.object_id = $1 and r.deleted_at is null and (exists (select 
      3011 ms       20 calls    150.55 ms mean  select count(*)::int as n from (select $6 from records r where r.object_id = $1 and r.deleted_at is null and (exists (select $7 from "values" v where v.workspac
      2332 ms      422 calls      5.53 ms mean  with c0 as materialized ( select d.owner_id as id_, d.workspace_id as ws_, d.text_key as dkey0_ from sort_keys d where d.attribute_id = $1 and d.live and d.text
      1112 ms     1351 calls      0.82 ms mean  select "workspace_id", "id", "object_id", "deleted_at", "deleted_by_type", "deleted_by_id", "deleted_by_member_id", "revision", "created_at", "created_by_type",
      1033 ms       23 calls     44.93 ms mean  select count(*)::int as n from (select $5 from records r where r.object_id = $1 and r.deleted_at is null and (exists (select $6 from "values" v where v.workspac
       778 ms      110 calls      7.07 ms mean  with c0 as materialized ( select d.owner_id as id_, d.workspace_id as ws_, d.date_key as dkey0_ from sort_keys d where d.attribute_id = $1 and d.live and d.date
INVALID (exit 2): unexpected errors were 9.184% of actions (limit 0.1%): 429 TOO_MANY_REQUESTS ×108.
```

### spread, 50 users, 2 minutes, smoke seed (after the reviews' fixes)

```
metric                                 target              p50    p95     p99     max  count  verdict
-------------------------------------  -----------------  ----  -----  ------  ------  -----  -------
read (scroll, filter or sort windows)  p95 ≤ 300 ms       41.2  163.4   865.9  2760.0    870  PASS
open a record                          p95 ≤ 200 ms       17.2   49.1    87.2    92.4    117  PASS
edit                                   p95 ≤ 250 ms       26.1  105.3   146.9   201.2    138  PASS
create                                 p95 ≤ 300 ms       40.3  130.4   130.4   130.4     36  PASS  (only 36 samples: a direction, not a measure)
read by position                                          34.3   95.8   132.2   160.6    429  REPORTED
read by cursor                                            53.8  236.1  1923.7  2760.0    441  REPORTED
count                                                     21.4   71.6   100.6   106.8    174  REPORTED  (not judged)
API handler time per request                              33.4   84.8   126.2   204.7   2037  REPORTED  (Server-Timing app: the server side of every request)
live delivery                          p95 ≤ 1000 ms                                          NOT BUILT YET  (milestone 3: Centrifugo clients)
API pool wait                          p95 ≤ 50 ms         0.0    0.1     0.5    42.4   2037  PASS
pooler wait (PgBouncer maxwait)        p95 ≤ 50 ms         0.0    0.0     0.0     0.0     24  PASS  (only 24 samples: a direction, not a measure)
Postgres CPU                           p95 ≤ 70%           9.7   39.4    44.0    44.0     24  PASS  (only 24 samples: a direction, not a measure)
API CPU                                                   19.1   43.0    44.8    44.8     24  REPORTED
relay lag                              p95 ≤ 250 ms                                           NOT BUILT YET  (milestone 3: the relay on the load stack)
unexpected errors                      ≤ 0.1% of actions                                   0  PASS  (0.000% of 1161 actions; over the limit the run is invalid)
expected refusals (409, 422)                                                               0  REPORTED
429 too many requests                                                                      0  REPORTED  (unexpected: a person would see this refusal)
counts aborted by a newer view                                                             0  REPORTED

scenario spread (gate), 50 users, 2 measured minutes after 60 s of warm up, seed 13
run 2026-10-11T20:59:15.966Z to 2026-10-11T21:02:18.973Z, git 86eeed875801b98e508b38886185fac7cde69be9, API http://localhost:3100, 1 thread(s)
host MacBookPro18,3, 8 cores, 16.0 GB; Docker 8 CPUs, 7.7 GB
stack caps: api 1 CPU/1.0 GB, centrifugo 1 CPU/0.5 GB, mailpit uncapped/0.0 GB, pgbouncer uncapped/0.0 GB, postgres 2 CPU/8.0 GB, worker 1 CPU/0.5 GB
database clock offset: -34.3 ms
manifest (smoke): deals 12,374 live of 12,500, companies 7,424 live of 7,500, people 29,683 live of 30,000
mix achieved: scroll 59.9%, filterSort 15.0%, open 10.1%, edit 11.9%, create 3.1% (largest gap 0.11 points)
actions: 1161 sent of 1161 planned; event loop p99 14.9 ms, 14.4 ms
WAL written: 9.7 MB
top statements by total time:
      3397 ms      401 calls      8.47 ms mean  select count(*)::int as n, case when count(*) < $1 then array_agg(id::text) end as ids from crm_search_text($2::uuid, $3, $4::int) as id
      2817 ms      601 calls      4.69 ms mean  with c0 as materialized ( select d.owner_id as id_, d.workspace_id as ws_, d.text_key as dkey0_ from sort_keys d where d.attribute_id = $1 and d.live and d.text
      2661 ms     1572 calls      1.69 ms mean  select "position", "text_value", "number_value"::text, "date_value"::text, to_char("timestamp_value" at time zone $1, $2), "bool_value", "option_id", "actor_typ
      1838 ms       84 calls     21.88 ms mean  select r.id::text as id, r.id::text as record_id, r.created_at::text as key0 from records r where r.object_id = $1 and r.deleted_at is null and (exists (select 
      1038 ms      222 calls      4.68 ms mean  with c0 as materialized ( select d.owner_id as id_, d.workspace_id as ws_, d.date_key as dkey0_ from sort_keys d where d.attribute_id = $1 and d.live and d.date
       893 ms       37 calls     24.14 ms mean  with c0 as materialized ( select d.owner_id as id_, d.workspace_id as ws_, d.code_key as dkey0_, d.number_key as dkey1_ from sort_keys d where d.attribute_id = 
       709 ms     1572 calls      0.45 ms mean  select "workspace_id", "id", "object_id", "deleted_at", "deleted_by_type", "deleted_by_id", "deleted_by_member_id", "revision", "created_at", "created_by_type",
       494 ms       17 calls     29.07 ms mean  select count(*)::int as n from (select $5 from records r where r.object_id = $1 and r.deleted_at is null and (exists (select $6 from "values" v where v.workspac
       458 ms       16 calls     28.64 ms mean  select r.id::text as id, r.id::text as record_id, r.created_at::text as key0 from records r where r.object_id = $1 and r.deleted_at is null and (exists (select 
       434 ms      117 calls      3.71 ms mean  select r.id::text as id, r.id::text as record_id from records r where r.object_id = $1 and r.deleted_at is null and (exists (select $5 from "values" v where v.w
VALID. Exit 0.
```

### Earlier runs, before the reviews' fixes

The first pair (steady seed 2, spread seed 3, same shape) gave steady: read p95 294 ms, open 276, edit 396, create 433, 17 × 429, Postgres CPU p95 33%; spread: read 413, open 174, edit 431, create 345, 9 × 429, Postgres CPU 51%. Both invalid on the 429s. Run to run, the same scenario swings from a clean pass to a heavy miss: which filter shapes the seed sends users to (the owner filter sorted by created took 86 to 130 ms a call in the steady run above) and what the other lanes run on the machine move the tail a long way, so these smoke numbers are a direction only.

### The run judging itself

| Check | How | Result |
|---|---|---|
| A stalled harness is invalid (AC-203) | `LOAD_TEST_BLOCK_LOOP_MS=80 node packages/load/scripts/run.ts steady --users 5 --minutes 1` | `INVALID (exit 2): the harness couldn't keep up: an event loop stalled 136.3 ms at p99 (limit 50 ms)` |
| Errors past 0.1% are invalid (AC-203) | the API stopped 30 seconds into the measured window (`docker compose … stop api`) | `INVALID (exit 2): unexpected errors were 55.814% of actions (limit 0.1%): dropped ×48` |
| An expired session refuses before the warm up (AC-196) | user 1's session row expired by hand | `User 1's session was refused. Mint the sessions again: pnpm load:sessions.` (exit 3); `pnpm load:sessions` minted them again |
| Reset gives the slots back (AC-209) | `pnpm load:reset` before and after each run | `Erased 46 records the harness made. 49,481 live records, 950,519 free slots.` after steady, 45 after spread: back to the manifest's live count each time, and no record made after `seededAt` remains (the seed suite checks the same, with the seeded rows untouched) |

### Misses and their plans

1. **429 `TOO_MANY_REQUESTS`, in every steady run so far (17 and 108) and the first spread (9).** Spec 0005's read gate lets 6 `records.query` and `records.count` calls run at once per workspace per API process, and one workspace with 50 people passes it. The overlap comes from a filter or sort sending its window and its count together, a position scroll sending up to 3 windows at once, and slow statements holding their places longer (a cursor jump's forward reads go one after another, so each holds one place). AC-203 counts every 429 as unexpected, so these runs are invalid. **Owner's call:** the browser's data layer retries a 429 up to 5 times after its `Retry-After` (`whenFree` in `packages/data/src/records/layer.ts`), so a person sees a wait rather than the refusal AC-203 assumes. Either keep AC-203 as written (the harness refuses to call a run with refusals valid), or have the harness retry as the browser does, counting the wait in the action's time and the 429s on their own line. **Decided (owner, 12 October 2026): keep AC-203 as written**; a 429 stays an unexpected error. Plan (#41): report the workspace's peak reads in flight, then size the gate to the budget (a per member limit inside a larger per workspace one, or a short queue instead of a refusal).
2. **steady's tail (second run): read p95 1.7 s, open 1.8 s, edit 2.5 s, create 3.7 s, while p50 stayed 22 to 53 ms.** The server was saturated: Postgres CPU p95 106% and the API's 111% of their caps (a `docker stats` sample covers about a second, so a burst reads past 100%), the API's pool wait p95 309 ms, and the API's own handler time p95 1.4 s. The heaviest statements were the owner filter sorted by created (86 ms mean, 130 ms in its other plan) and Deals sorted by value (43 ms mean). Plan (#41): run `steady` at 100 users on the `crm` seed on a quiet machine first; then the owner by created plan and a larger API pool or a second API replica, by the numbers.
3. **create rests on 35 samples at 2 minutes and 50 users,** so its verdict is a direction (the report now says so under 100 samples). The 10 minute gate at 100 users gives about 360.
4. **Cursor reads have the longest tail in both scenarios** (spread p99 1.9 s, max 2.8 s): long forward reads from a checkpoint (a jump anywhere in a filtered view reads 200 rows per call, up to row 10,000). Plan (#41): judge on the `crm` seed first; if it holds there, give cursor jumps a seek from a sort key (spec 0006's open question) rather than more forward calls.
5. **PgBouncer's `maxwait` never moved off 0** in any run: the API's pools (10 tenant, 5 identity per process) sit under PgBouncer's 20, so the wait happens in the API's own pool, which the `Server-Timing` line shows. The line is the spec's (AC-201); #41 can add `SHOW STATS` wait deltas if a larger API pool moves the queue into PgBouncer.

### Calls made in this milestone

- 0006 task 6 had landed (filter, sorts and `canJump`), so step 8 built nothing.
- A scroll moves 1 to 3 windows and reads each window it passes (by position, at once; by cursor, one after another); 20% of scrolls jump (`JUMP_SHARE`, a model choice, not a target).
- Filter or sort picks among each object's plain view, its name sort (both by position) and the spec's filtered shapes (by cursor).
- Windows read the columns on screen (the first 10 by position, plus what edits, filters and sorts need), as the People table does; an open reads the whole record.
- A scroll while a view's first window loads waits for it; a cursor scroll from the first half of a 200 row read reads on from the nearest checkpoint, as spec 0006's windows do.
- Actions still running 60 seconds after the window closes are unexpected errors (`unfinished`); the achieved mix is counted from what was sent; a judged line under 100 samples carries a note.
- The report adds the API's own handler time per request (`app` in `Server-Timing`) and the API container's CPU, reported beside Postgres's.
- The mix follows a golden ratio sequence over the arrivals in time order, so it holds within a point even on short runs (independent draws drift several points on the weekly smoke's 480 actions).
- `db` in `Server-Timing` is the time the request held a database client (its queries and their round trips); `pool` is the time it waited for one, across the tenant and identity pools.
- `pg_stat_statements` is turned on by `pnpm load:seed` and `pnpm load:run` as the load stack's superuser inside its container (the extension, `pg_read_all_stats` and the reset for the owner login); off the load stack the statements line says it wasn't measured.
- Putting the hub's Team back (AC-209's second half) waits for the `hub` scenario in milestone 4, the first that moves people off it.

### Owner steps

- None. The owner waived the million record gate run (12 October 2026): no Docker 12 GB step, and the `smoke` seed runs above stand as this milestone's proof.

## Milestone 3: live delivery (12 October 2026)

### Where it ran

The same machine and stack as milestone 2 (Docker at 7.75 GB; the owner waived the million record gate run on 12 October 2026), on the `smoke` seed (50,000 records, 50 users), with the load stack's relay and tokens now on: the API pokes `http://worker:3101` and signs Centrifugo tokens, the worker publishes to `http://centrifugo:9000`, and every simulated user holds a Centrifugo connection and the workspace channel. The worker runs spec 0008's jobs too (`crm_worker_user`, `JOBS_RUNNER` on, its local default). Before these runs the seeded database took the migrations that landed since it was seeded and the worker login, by hand (`packages/load/AGENTS.md`). Other build lanes were idle this time. 50 users for 3 measured minutes (steady) and 2 (storm), not the gate's 100 for 10.

The re-review's fixes landed after these runs (a connect still retrying gives up when the storm reconnects, a failed token call counts once, arrivals bucket with the start's clock offset, scheduled refetches hold the drain); none changes a measured path these runs took (both offsets were under 2 ms, no token call failed, no coarse event came), so the runs stand.

Step 16 needed no change to the hook: spec 0007 had landed, so `created_at` is already `clock_timestamp()` and every event carries `at`.

### steady, 50 users, 3 minutes, smoke seed (after the review's fixes)

```
metric                                     target              p50    p95    p99     max  count  verdict
-----------------------------------------  -----------------  ----  -----  -----  ------  -----  -------
read (scroll, filter or sort windows)      p95 ≤ 300 ms       40.6  135.2  251.7  2270.5   1371  PASS
open a record                              p95 ≤ 200 ms       18.0   39.8   80.0   117.1    184  PASS
edit                                       p95 ≤ 250 ms       26.3   79.6  124.5   182.1    222  PASS
create                                     p95 ≤ 300 ms       32.6   86.0  176.1   176.1     56  PASS  (only 56 samples: a direction, not a measure)
read by position                                              33.2   67.9  105.5   137.1    551  REPORTED
read by cursor                                                50.6  165.1  365.4  2270.5    820  REPORTED
count                                                         22.9   69.9  110.9   127.3    275  REPORTED  (not judged)
API handler time per request                                  26.6   65.5  116.8   239.6   5663  REPORTED  (Server-Timing app: the server side of every request)
live delivery (commit to visible)          p95 ≤ 1000 ms      34.9   73.9   77.5    90.0    176  PASS
scheduled to visible                                          53.1  124.8  140.2   171.6    176  REPORTED  (from the writer's scheduled moment to each holder's refetch)
event arrival (commit to each subscriber)                      5.7   15.7   20.7    78.7  13900  REPORTED  (live events only, in 1 ms buckets)
delivery after recovery or catch up                                                              NO SAMPLES  (not judged: the gap is the point)
settle (window and count reread)                              34.9   81.5  146.2   233.9   1228  REPORTED  (after a create, delete or reorder of the view)
API pool wait                              p95 ≤ 50 ms         0.0    0.1    0.1    82.4   5663  PASS
pooler wait (PgBouncer maxwait)            p95 ≤ 50 ms         0.0    0.0    0.0     0.0     36  PASS  (only 36 samples: a direction, not a measure)
Postgres CPU                               p95 ≤ 70%          19.3   48.9   60.2    60.2     36  PASS  (only 36 samples: a direction, not a measure)
API CPU                                                       29.5   81.2   84.8    84.8     36  REPORTED
relay lag                                  p95 ≤ 250 ms        3.7    7.3   13.0    70.3    278  PASS
missed seqs                                0                                                  0  PASS  (no event, stub or catch up within 10 s)
seqs caught up (realtime.catchUp)                                                             0  REPORTED  (50 catch up calls, 0 answered reset)
seqs recovered by Centrifugo                                                                  0  REPORTED
events applied                                                                            13900  REPORTED  (278 own echoes skipped, 0 stubs, 8292 of another object discarded (60.9% of records events))
unexpected errors                          ≤ 0.1% of actions                                 32  MISS  (1.734% of 1845 actions; over the limit the run is invalid)
expected refusals (409, 422)                                                                  0  REPORTED
429 too many requests                                                                        32  REPORTED  (unexpected: a person would see this refusal; by what sent it: read 12, count 2, settle 18)
counts aborted by a newer view                                                                0  REPORTED

scenario steady (gate), 50 users, 3 measured minutes after 60 s of warm up, seed 62
run 2026-10-12T11:20:51.053Z to 2026-10-12T11:24:54.103Z, git 621e74d56097cf9690691b3c0f687c46f3df0400, API http://localhost:3100, 1 thread(s)
host MacBookPro18,3, 8 cores, 16.0 GB; Docker 8 CPUs, 7.7 GB
stack caps: api 1 CPU/1.0 GB, centrifugo 1 CPU/0.5 GB, mailpit uncapped/0.0 GB, pgbouncer uncapped/0.0 GB, postgres 2 CPU/8.0 GB, worker 1 CPU/0.5 GB
database clock offset: -0.3 ms (moved 0.4 ms from start to end)
manifest (smoke): deals 12,374 live of 12,500, companies 7,424 live of 7,500, people 29,683 live of 30,000
mix achieved: scroll 60.0%, filterSort 15.0%, open 10.0%, edit 12.0%, create 3.0% (largest gap 0.04 points)
actions: 1845 sent of 1845 planned; event loop p99 11.9 ms, 12.9 ms
WAL written: 15.8 MB
unexpected errors: 429 TOO_MANY_REQUESTS ×32
top statements by total time: (in the result JSON)
INVALID (exit 2): unexpected errors were 1.734% of actions (limit 0.1%): 429 TOO_MANY_REQUESTS ×32.
```

### storm, 50 users, 2 minutes, smoke seed (after the review's fixes)

```
metric                                          target               p50    p95    p99     max  count  verdict
----------------------------------------------  -----------------  -----  -----  -----  ------  -----  -------
read (scroll, filter or sort windows)           p95 ≤ 300 ms        45.6  156.7  328.1  1945.1    877  PASS
open a record                                   p95 ≤ 200 ms        18.4   58.4  101.6   122.1    116  PASS
edit                                            p95 ≤ 250 ms        27.3   63.0  101.1   189.6    140  PASS
create                                          p95 ≤ 300 ms        36.3  157.4  160.7   160.7     36  PASS  (only 36 samples: a direction, not a measure)
read by position                                                    34.8   82.2  131.6   348.5    355  REPORTED
read by cursor                                                      57.3  180.0  402.0  1945.1    522  REPORTED
count                                                               25.3   72.2  111.0   128.1    175  REPORTED  (not judged)
API handler time per request                                        29.1   89.6  161.4   253.7   4268  REPORTED  (Server-Timing app: the server side of every request)
live delivery (commit to visible)               p95 ≤ 1000 ms       33.4   79.5  102.1   196.8    161  PASS
scheduled to visible                                                51.8  103.3  240.9   274.5    161  REPORTED  (from the writer's scheduled moment to each holder's refetch)
event arrival (commit to each subscriber)                            5.6   11.6   21.6    81.6  32700  REPORTED  (live events only, in 1 ms buckets)
delivery after recovery or catch up                                                                    NO SAMPLES  (not judged: the gap is the point)
settle (window and count reread)                                    42.5  102.5  202.3   381.5    810  REPORTED  (after a create, delete or reorder of the view)
API pool wait                                   p95 ≤ 50 ms          0.0    0.1   20.5    97.5   4268  PASS
pooler wait (PgBouncer maxwait)                 p95 ≤ 50 ms          0.0    0.0    0.0     0.0     24  PASS  (only 24 samples: a direction, not a measure)
Postgres CPU                                    p95 ≤ 70%           28.9   52.3   54.8    54.8     24  PASS  (only 24 samples: a direction, not a measure)
API CPU                                                             26.6   44.8   46.5    46.5     24  REPORTED
relay lag                                       p95 ≤ 250 ms         3.3    9.2   16.5    76.7    656  PASS
missed seqs                                     0                                                   0  PASS  (no event, stub or catch up within 10 s)
seqs caught up (realtime.catchUp)                                                                   0  REPORTED  (50 catch up calls, 0 answered reset)
seqs recovered by Centrifugo                                                                      100  REPORTED
events applied                                                                                  32800  REPORTED  (656 own echoes skipped, 0 stubs, 20160 of another object discarded (62.7% of records events))
edit inside bursts                              p95 ≤ 250 ms        28.9  159.2  261.6   395.9    550  PASS
reconnect: drop to back (max: every user back)                     231.2  325.0  338.2   338.2     50  REPORTED  (50 dropped: 50 recovered by Centrifugo, 0 caught up, 0 reset, 0 never back)
unexpected errors                               ≤ 0.1% of actions                                  17  MISS  (0.988% of 1721 actions; over the limit the run is invalid)
expected refusals (409, 422)                                                                        0  REPORTED
429 too many requests                                                                              17  REPORTED  (unexpected: a person would see this refusal; by what sent it: read 2, count 2, settle 13)
counts aborted by a newer view                                                                      0  REPORTED

scenario storm (reported, exits by validity only), 50 users, 2 measured minutes after 60 s of warm up, seed 63
run 2026-10-12T11:25:06.891Z to 2026-10-12T11:28:09.938Z, git 621e74d56097cf9690691b3c0f687c46f3df0400, API http://localhost:3100, 1 thread(s)
host MacBookPro18,3, 8 cores, 16.0 GB; Docker 8 CPUs, 7.7 GB
stack caps: api 1 CPU/1.0 GB, centrifugo 1 CPU/0.5 GB, mailpit uncapped/0.0 GB, pgbouncer uncapped/0.0 GB, postgres 2 CPU/8.0 GB, worker 1 CPU/0.5 GB
database clock offset: -0.4 ms (moved 1.5 ms from start to end)
manifest (smoke): deals 12,374 live of 12,500, companies 7,424 live of 7,500, people 29,683 live of 30,000
mix achieved: scroll 59.9%, filterSort 15.1%, open 9.9%, edit 12.0%, create 3.1% (largest gap 0.12 points)
actions: 1721 sent of 1721 planned; event loop p99 13.8 ms, 14.1 ms
WAL written: 36.0 MB
unexpected errors: 429 TOO_MANY_REQUESTS ×17
top statements by total time: (in the result JSON)
INVALID (exit 2): unexpected errors were 0.988% of actions (limit 0.1%): 429 TOO_MANY_REQUESTS ×17.
```

### What the runs say

- **Live delivery holds with room:** commit to visible p95 74 ms in steady and 80 ms in storm against 1 second; relay lag p95 7 ms and 9 ms against 250 ms; commit to arrival p95 16 ms and 12 ms at every subscriber (13,900 and 32,700 arrivals). No seq was missed in either run.
- **The reconnect storm recovers through Centrifugo:** all 50 users came back by recovery from the position they reached (100 seqs replayed, no catch up, no reset), the last 338 ms after the drop. A Centrifugo restart (history lost) would send them through `realtime.catchUp` instead; that path is proven by the unit tests, not by a run yet.
- **Bursts:** 550 burst edits, p95 159 ms, while the mix's own edits stayed at 63 ms.
- **Both runs are invalid on 429s, as in milestone 2** (the owner kept AC-203 as written): 32 in steady and 17 in storm. Most now come from the live client's settles (18 of 32, 13 of 17): every create, delete or restore in an object, and every change to an attribute a view sorts or filters on, rereads the window and count of every user holding that object 1.5 to 7 seconds later, as the browser does (1,228 settle rereads in steady's 3 minutes, beside 1,845 actions).
- **The discarded share is about 61 to 63%:** that share of records events reached a user holding another object (spec 0007's AC-91 number; with three objects and one view each it is what one channel per workspace costs).

### Earlier run, before the review's fixes

A 20 user, 2 minute storm on the first build (other lanes busy on the machine) gave live delivery p95 1.5 s with the API at 117% of its CPU cap and 145 429s; every user came back by recovery in about a second. Its burst edits used the window's rows (users on the same view could collide); the fixes moved them to the object's samples.

### Misses and their plans

1. **429s, now mostly from settles.** The live client adds the browser's settle rereads to the read gate's 6 in flight. Plan (#41): with the owner's call standing, decide between spreading the settle wider (or letting a create in another user's view settle only when the view shows the count change), raising the gate for live rereads, or a short queue instead of a refusal; the harness's 429 line now says what sent each.
2. **The holder is smaller than a browser's** (a known underestimate of refetch load): the harness holds the 100 rows on screen; the browser keeps blocks within 5 of the screen and an open record page. Refetches don't fetch `updated_at` and `updated_by` either (response bytes only).
3. **`storm` exits by validity only** (spec: `hub`, `storm` and `thousand` are judged in #41), so missed seqs above 0 would show as a miss on its line without failing the run. Both runs missed none.
4. **The reconnect is the worst case on purpose:** every user drops and asks for new tokens in the same millisecond, where browsers would spread their reconnects with backoff jitter.

### Owner steps

- None. The million record gate run stays waived; milestone 4 (`thousand`, `hub`, the bench and the weekly smoke) is next.
