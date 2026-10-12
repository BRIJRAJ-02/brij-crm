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

## Milestone 4: 1,000 users, the hub, and the weekly smoke (12 October 2026)

### What was built

- **Task 20, 1,000 users (AC-203, AC-208).** A run spreads its users over worker threads, 250 to a thread unless `--threads` says otherwise (`threadsFor`), and checks each thread's event loop on its own, naming the one that stalled (`the main thread`, `thread 1` and so on). `thousand` plays 1,000 seeded members, each with its own minted session, on the steady mix for 5 measured minutes, prints every verdict and exits by validity only. `pnpm load:seed` takes `--users N` (1 to 1,000), so a small seed can carry 1,000 different people.
- **Task 21, the hub (AC-206, AC-209).** `hub` plays 100 users on the steady mix where half the edits move one of the user's own people to or from the hub (from the person's Company) and a fifth of the opens read the hub whole (its Team as the first 20 links and the total), while user 1 renames the hub every 10 seconds (`Hub Company (renamed 1)`, `(renamed 2)` and so on, after the reviews; the runs below swapped between two names). The report adds `hub renames`, `hub moves`, `hub moves while a rename ran`, `hub open` and `writes out of retries (runWrite)`; the WAL line was already on every report. `pnpm load:reset` now also puts back every seeded person's Company that moved since `seededAt` (so the hub's Team is the seeded one again), through the engine's batch write as the system actor, 5,000 people a batch in engine calls of 500, and the hub's name.
- **Task 22, the hub clear bench (AC-214).** `pnpm load:bench-hub-clear` (`packages/core/scripts/bench-hub-clear.ts`) clears the hub's Team in one whole value write as the system actor while 100 engine level writers link other people to the hub and to other companies at 0.2 a second each, through one pool of 10 connections, then writes the Team back the way the reset does, whatever happened.
- **Task 23, the weekly smoke (AC-211).** `.github/workflows/load-smoke.yml` runs on Mondays at 06:00 UTC and on demand, never on a push. It seeds the smoke profile on the runner's own load stack, plays `steady --users 20 --minutes 2`, judges the result with `packages/load/scripts/smoke.ts` (a warning per judged miss, a failure for an invalid run or a crash, the table on the run's summary page), uploads `.load/results/` (never the sessions file) and wipes the throwaway stack. It needs no secrets and touches no deployed environment. `actionlint` 1.7.7 (its Docker image) passes it with no findings.
- **Task 24.** `packages/load/AGENTS.md` names the new commands, scenarios and report lines; the runs are below.

### Where it ran

The reference machine (MacBookPro18,3, M1 Pro, 8 cores, 16 GB) with Docker at 8 CPUs and **7.75 GB** (the owner keeps it there). The load stack's data services and then its api and worker were started with `docker compose -f docker-compose.load.yml -p crm-load up` directly, as in milestones 2 and 3, since `pnpm load:stack` refuses under 11 GB.

The load volume was wiped and seeded again with `pnpm load:seed --profile smoke --users 1000` (the same 50,000 records, and 1,000 members instead of 50, so `thousand` has 1,000 different people and `hub` and `storm` their 100). The seed took 53 seconds. **Every criterion that names the million record `crm` seed ran on this smoke seed instead, as the owner decided (the million seed run is waived, 12 October 2026):** the hub's Team holds 7,500 people here, not 150,000 (AC-194, AC-206, AC-214), and `thousand` reads a 50,000 record workspace (AC-208).

Two things made these numbers noisier than milestone 3's:

- **The machine was oversubscribed.** Other build lanes ran their suites and benches beside these runs; the load average was 15 to 19 on 8 cores (`uptime` at 13:35 UTC). With Docker's caps already taking 5 cores, the API and Postgres got less than their caps.
- **Another lane shared the load stack.** The load stack is one Docker project for the whole machine. While the first `hub` run was measuring, another lane's jobs fairness bench (`packages/core/scripts/jobs-fairness.ts`, spec 0008) restarted the load stack's Postgres, rebuilt the shared `crm-load-worker` image, and wrote about 1.1 million `job_items` rows into this database: its two statements took 90 seconds of Postgres time in a 2 minute window, and the run wrote 393 MB of WAL. That run (seed 402) is thrown away; every run below came after that lane finished and stopped the stack, with the api and worker images built again from this branch.

Full runs would take: `hub`, `storm` and `steady` 10 measured minutes each (about 12 with the warm up and the drain), `thousand` 5 (about 7), each on the `crm` seed, which needs Docker at 12 GB and a seed of up to an hour (AC-195). Each ran here for 2 measured minutes, the shortest that gives every line samples, one at a time, with `pnpm load:reset` between runs.

### hub, 100 users, 2 minutes, smoke seed with 1,000 members

```
metric                                        target               p50     p95     p99     max  count  verdict
--------------------------------------------  -----------------  -----  ------  ------  ------  -----  -------
read (scroll, filter or sort windows)         p95 ≤ 300 ms       166.5  1010.1  2265.1  2792.8    865  MISS
open a record                                 p95 ≤ 200 ms       234.9  1797.4  2871.8  2953.3    194  MISS
edit                                          p95 ≤ 250 ms       391.1  2403.9  3273.0  3641.3    284  MISS
create                                        p95 ≤ 300 ms       449.5  2850.9  3770.3  3770.3     71  MISS  (only 71 samples: a direction, not a measure)
read by position                                                 121.9   833.0  2265.1  2451.3    350  REPORTED
read by cursor                                                   194.2  1076.1  2123.2  2792.8    515  REPORTED
count                                                            119.5   874.4  1699.1  2446.2    286  REPORTED  (not judged)
API handler time per request                                     172.2  1062.3  1682.9  2785.0   8256  REPORTED  (Server-Timing app: the server side of every request)
live delivery (commit to visible)             p95 ≤ 1000 ms      250.2   759.8   921.1  2550.5    309  PASS
scheduled to visible                                             420.1  1511.3  2365.3  4982.7    309  REPORTED  (from the writer's scheduled moment to each holder's refetch)
event arrival (commit to each subscriber)                         19.8    91.8   190.8   263.8  50200  REPORTED  (live events only, in 1 ms buckets)
delivery after recovery or catch up                                                                    NO SAMPLES  (not judged: the gap is the point)
settle (window and count reread)                                 115.3   659.6  2263.4  2989.0    697  REPORTED  (after a create, delete or reorder of the view)
API pool wait                                 p95 ≤ 50 ms         29.5   865.9  1258.0  2091.8   8256  MISS
pooler wait (PgBouncer maxwait)               p95 ≤ 50 ms          0.0     0.0     0.0     0.0     24  PASS  (only 24 samples: a direction, not a measure)
Postgres CPU                                  p95 ≤ 70%           45.6    70.4    78.6    78.6     24  MISS  (only 24 samples: a direction, not a measure)
API CPU                                                           93.8   106.8   113.0   113.0     24  REPORTED
relay lag                                     p95 ≤ 250 ms        15.8    82.9   184.7   255.0    502  PASS
missed seqs                                   0                                                     0  PASS  (no event, stub or catch up within 10 s)
seqs caught up (realtime.catchUp)                                                                   0  REPORTED  (100 catch up calls, 0 answered reset)
seqs recovered by Centrifugo                                                                        0  REPORTED
events applied                                                                                  50200  REPORTED  (367 own echoes skipped, 0 stubs, 32084 of another object discarded (64.4% of records events))
hub renames (every 10 s)                      p95 ≤ 250 ms       385.8  1311.4  1311.4  1311.4     12  MISS  (only 12 samples: a direction, not a measure)
hub moves (a person to or from the hub)                          461.1  2623.4  3273.0  3641.3    135  REPORTED  (written from the person's Company)
hub moves while a rename ran                  p95 ≤ 250 ms       569.3  2094.3  2094.3  2094.3     10  MISS  (only 10 samples: a direction, not a measure)
hub open (first 20 Team links and the total)                     452.9  1894.6  2713.5  2713.5     44  REPORTED  (not judged)
writes out of retries (runWrite)                                                                    0  REPORTED  (answered 503 QUERY_CANCELLED, of 367 writes; unexpected, so in the error share)
unexpected errors                             ≤ 0.1% of actions                                  2638  MISS  (110.701% of 2383 actions; over the limit the run is invalid)
expected refusals (409, 422)                                                                        0  REPORTED
429 too many requests                                                                            2638  REPORTED  (unexpected: a person would see this refusal; by what sent it: read 913, count 253, settle 1472)
counts aborted by a newer view                                                                     12  REPORTED
scenario hub (reported, exits by validity only), 100 users, 2 measured minutes after 60 s of warm up, seed 403
run 2026-10-12T13:16:29.651Z to 2026-10-12T13:19:33.952Z, git e26870c792a7e965a3abb2b2d8868f4ee0404a45, API http://localhost:3100, 1 thread(s)
host MacBookPro18,3, 8 cores, 16.0 GB; Docker 8 CPUs, 7.7 GB
stack caps: api 1 CPU/1.0 GB, centrifugo 1 CPU/0.5 GB, mailpit uncapped/0.0 GB, pgbouncer uncapped/0.0 GB, postgres 2 CPU/8.0 GB, worker 1 CPU/0.5 GB
database clock offset: -1.3 ms (moved 1.6 ms from start to end)
manifest (smoke): deals 12,394 live of 12,500, people 29,718 live of 30,000, companies 7,425 live of 7,500
mix achieved: scroll 60.0%, filterSort 15.0%, open 10.0%, edit 12.0%, create 3.0% (largest gap 0.04 points)
actions: 2383 sent of 2383 planned; event loop p99: the main thread 19.2 ms, thread 1 19.8 ms
WAL written: 10.4 MB
unexpected errors: 429 TOO_MANY_REQUESTS ×2638
INVALID (exit 2): unexpected errors were 110.701% of actions (limit 0.1%): 429 TOO_MANY_REQUESTS ×2638.
```

Result JSON: `.load/results/hub-2026-10-12T13-16-29.651Z.json`. The heaviest statements were the owner filter sorted by created (72 ms a call) and the filtered counts (48 to 90 ms); the hub open's link total read took 31 ms a call.

### thousand, 1,000 users over 4 threads, 2 minutes

```
metric                                     target               p50     p95     p99     max  count  verdict
-----------------------------------------  -----------------  -----  ------  ------  ------  -----  -------
read (scroll, filter or sort windows)      p95 ≤ 300 ms                                             NO SAMPLES
open a record                              p95 ≤ 200 ms                                             NO SAMPLES
edit                                       p95 ≤ 250 ms                                             NO SAMPLES
create                                     p95 ≤ 300 ms                                             NO SAMPLES
read by position                                                                                    NO SAMPLES
read by cursor                                                                                      NO SAMPLES
count                                                                                               NO SAMPLES  (not judged)
API handler time per request                                                                        NO SAMPLES  (Server-Timing app: the server side of every request)
live delivery (commit to visible)          p95 ≤ 1000 ms                                            NO SAMPLES
scheduled to visible                                                                                NO SAMPLES  (from the writer's scheduled moment to each holder's refetch)
event arrival (commit to each subscriber)                     675.1  2703.1  6793.1  6801.1    246  REPORTED  (live events only, in 1 ms buckets)
delivery after recovery or catch up                                                                 NO SAMPLES  (not judged: the gap is the point)
settle (window and count reread)                                                                    NO SAMPLES  (after a create, delete or reorder of the view)
API pool wait                                                                                       NOT MEASURED  (no Server-Timing header: is LOAD_TIMING=on?)
pooler wait (PgBouncer maxwait)            p95 ≤ 50 ms          0.0     0.0     0.0     0.0     25  PASS  (only 25 samples: a direction, not a measure)
Postgres CPU                               p95 ≤ 70%           45.1   105.6   148.2   148.2     25  MISS  (only 25 samples: a direction, not a measure)
API CPU                                                       129.0   159.9   165.8   165.8     25  REPORTED
relay lag                                  p95 ≤ 250 ms       631.7  2201.5  6780.1  6780.1     41  MISS  (only 41 samples: a direction, not a measure)
missed seqs                                0                                                 39935  MISS  (no event, stub or catch up within 10 s; 39935 never heard of by the end)
seqs caught up (realtime.catchUp)                                                                0  REPORTED  (82 catch up calls, 0 answered reset)
seqs recovered by Centrifugo                                                                     0  REPORTED
events applied                                                                                 246  REPORTED  (2 own echoes skipped, 0 stubs, 147 of another object discarded (60.2% of records events))
unexpected errors                          ≤ 0.1% of actions                                 36144  MISS  (151.700% of 23826 actions; over the limit the run is invalid)
expected refusals (409, 422)                                                                     0  REPORTED
429 too many requests                                                                            0  REPORTED  (unexpected: a person would see this refusal)
counts aborted by a newer view                                                                9518  REPORTED
scenario thousand (reported, exits by validity only), 1000 users, 2 measured minutes after 60 s of warm up, seed 404
run 2026-10-12T13:22:22.168Z to 2026-10-12T13:26:12.259Z, git e26870c792a7e965a3abb2b2d8868f4ee0404a45, API http://localhost:3100, 4 thread(s)
host MacBookPro18,3, 8 cores, 16.0 GB; Docker 8 CPUs, 7.7 GB
stack caps: api 1 CPU/1.0 GB, centrifugo 1 CPU/0.5 GB, mailpit uncapped/0.0 GB, pgbouncer uncapped/0.0 GB, postgres 2 CPU/8.0 GB, worker 1 CPU/0.5 GB
database clock offset: -6.8 ms (moved -11.8 ms from start to end)
manifest (smoke): deals 12,394 live of 12,500, people 29,718 live of 30,000, companies 7,425 live of 7,500
mix achieved: scroll 60.0%, filterSort 15.0%, open 10.0%, edit 12.0%, create 3.0% (largest gap 0.01 points)
actions: 23280 sent of 23826 planned; event loop p99: the main thread 32.7 ms, thread 1 330.3 ms, thread 2 533.7 ms, thread 3 390.9 ms, thread 4 430.7 ms
WAL written: 2.2 MB
unexpected errors: timeout ×32205, timeout (realtime.subscriptionToken) ×3483, timeout (realtime.connectionToken) ×420, timeout (realtime.catchUp) ×36
INVALID (exit 2): the harness couldn't keep up: thread 1 stalled 330.3 ms at p99 on its event loop (limit 50 ms); the harness couldn't keep up: thread 2 stalled 533.7 ms at p99 on its event loop (limit 50 ms); the harness couldn't keep up: thread 3 stalled 390.9 ms at p99 on its event loop (limit 50 ms); the harness couldn't keep up: thread 4 stalled 430.7 ms at p99 on its event loop (limit 50 ms); unexpected errors were 151.700% of actions (limit 0.1%): timeout ×32205, timeout (realtime.subscriptionToken) ×3483, timeout (realtime.connectionToken) ×420, timeout (realtime.catchUp) ×36.
```

To tell the harness's limit from the server's, the same scenario ran with 250 users in one thread for 1 minute (seed 406): the thread kept up (`event loop p99: the main thread 19.6 ms, thread 1 27.3 ms`, 2,960 of 2,960 actions sent on time), while the API saturated (API CPU p95 122%, API pool wait p95 8.2 s, read p95 11.1 s, edit p95 9.4 s, live delivery p95 8.8 s, 4,386 × 429 and 2,034 timeouts, 0 missed seqs: invalid, exit 2). So 250 users fit one harness thread; at 1,000 the API stops answering within 10 seconds at all, and four threads drowning in timeouts stall, on a host whose other lanes already used every core.

### storm, 100 users, 2 minutes

```
metric                                          target               p50     p95      p99      max   count  verdict
----------------------------------------------  -----------------  -----  ------  -------  -------  ------  -------
read (scroll, filter or sort windows)           p95 ≤ 300 ms       112.4   662.5   5878.0  10401.0     915  MISS
open a record                                   p95 ≤ 200 ms       139.1  6492.7   9183.1   9950.2     229  MISS
edit                                            p95 ≤ 250 ms       206.5  7280.9   9285.3   9870.6     252  MISS
create                                          p95 ≤ 300 ms       219.6  7109.8   9976.0   9976.0      63  MISS  (only 63 samples: a direction, not a measure)
read by position                                                    92.5   708.7   6108.4   9118.5     353  REPORTED
read by cursor                                                     127.1   588.0   1838.9  10401.0     562  REPORTED
count                                                               78.9   549.9   3233.9   7163.2     288  REPORTED  (not judged)
API handler time per request                                       138.5  5095.6   7688.4   9910.5    9727  REPORTED  (Server-Timing app: the server side of every request)
live delivery (commit to visible)               p95 ≤ 1000 ms      188.6  1706.8   6223.8   9486.5     846  MISS
scheduled to visible                                               313.6  1476.0  14422.4  16948.2     837  REPORTED  (from the writer's scheduled moment to each holder's refetch)
event arrival (commit to each subscriber)                           14.5    55.5    146.5    498.5  133067  REPORTED  (live events only, in 1 ms buckets)
delivery after recovery or catch up                                820.9  1356.0   1356.0   1356.0       4  REPORTED  (not judged: the gap is the point)
settle (window and count reread)                                    92.2   410.7    693.9   1478.6     941  REPORTED  (after a create, delete or reorder of the view)
API pool wait                                   p95 ≤ 50 ms         19.6  4627.7   7139.3   9628.0    9727  MISS
pooler wait (PgBouncer maxwait)                 p95 ≤ 50 ms          0.0     0.0      0.0      0.0      24  PASS  (only 24 samples: a direction, not a measure)
Postgres CPU                                    p95 ≤ 70%           59.2    79.2     86.4     86.4      24  MISS  (only 24 samples: a direction, not a measure)
API CPU                                                             91.7   133.1    134.0    134.0      24  REPORTED
relay lag                                       p95 ≤ 250 ms        11.5    46.5    122.0    450.1    1342  PASS
missed seqs                                     0                                                        0  PASS  (no event, stub or catch up within 10 s)
seqs caught up (realtime.catchUp)                                                                       16  REPORTED  (100 catch up calls, 0 answered reset)
seqs recovered by Centrifugo                                                                           957  REPORTED
events applied                                                                                      134024  REPORTED  (1341 own echoes skipped, 0 stubs, 83175 of another object discarded (62.7% of records events))
edit inside bursts                              p95 ≤ 250 ms       859.0  6797.5   7176.8   7264.8    1000  MISS
reconnect: drop to back (max: every user back)                     732.8  1119.6   1127.3   1128.3     100  REPORTED  (100 dropped: 100 recovered by Centrifugo, 0 caught up, 0 reset, 0 never back)
unexpected errors                               ≤ 0.1% of actions                                     2608  MISS  (75.115% of 3472 actions; over the limit the run is invalid)
expected refusals (409, 422)                                                                             0  REPORTED
429 too many requests                                                                                 2375  REPORTED  (unexpected: a person would see this refusal; by what sent it: read 845, count 253, settle 1277)
counts aborted by a newer view                                                                          60  REPORTED
scenario storm (reported, exits by validity only), 100 users, 2 measured minutes after 60 s of warm up, seed 405
run 2026-10-12T13:26:45.645Z to 2026-10-12T13:29:48.877Z, git e26870c792a7e965a3abb2b2d8868f4ee0404a45, API http://localhost:3100, 1 thread(s)
host MacBookPro18,3, 8 cores, 16.0 GB; Docker 8 CPUs, 7.7 GB
stack caps: api 1 CPU/1.0 GB, centrifugo 1 CPU/0.5 GB, mailpit uncapped/0.0 GB, pgbouncer uncapped/0.0 GB, postgres 2 CPU/8.0 GB, worker 1 CPU/0.5 GB
database clock offset: -0.1 ms (moved 0.9 ms from start to end)
manifest (smoke): deals 12,394 live of 12,500, people 29,718 live of 30,000, companies 7,425 live of 7,500
mix achieved: scroll 60.0%, filterSort 15.0%, open 10.0%, edit 12.0%, create 3.0% (largest gap 0.03 points)
actions: 3472 sent of 3472 planned; event loop p99: the main thread 18.6 ms, thread 1 22.4 ms
WAL written: 42.5 MB
unexpected errors: 429 TOO_MANY_REQUESTS ×2375, timeout ×233
INVALID (exit 2): unexpected errors were 75.115% of actions (limit 0.1%): 429 TOO_MANY_REQUESTS ×2375, timeout ×233.
```

### The hub clear bench, smoke seed (7,419 live people in the Team)

```
Hub clear bench on "load" at localhost:5434/crm.
100 writers at 0.2 a second each through a pool of 10; the hub's Team holds 7,419 people
clearing the hub's Team in one write
cleared in 239 ms; the writers go on for 10000 ms
writing the hub's Team back
hub Team: put back 5000 of 7784
hub Team: put back 7784 of 7784

clear of the hub's Team (7,419 links, one write): 239 ms

other writes (ms)                      p50     p95     p99     max  count
all, from their scheduled moment      18.8    64.0   119.9   160.4    410
beside the clear                      35.9    47.4    47.4    47.4      4

out of retries (runWrite): 0
writes that failed: none
WAL written during the clear (the writers' share included): 5.1 MB
Team written back: 7,784 people in 100.5 s
Reported, not judged (#41 judges it).
```

After the reviews the bench also measures its own event loop during the clear and vacuums after the write back. Run again (13:29 UTC, the host's load average 32 on 8 cores):

```
clear of the hub's Team (7,419 links, one write): 260 ms

other writes (ms)                      p50     p95     p99     max  count
all, from their scheduled moment      28.9   167.1   730.3  1116.4    410
beside the clear                      43.6    65.0    65.0    65.0      4
(the writers move people outside the hub, so beside the clear they meet the pool, CPU and WAL, not its row locks;
 this process's event loop stalled up to 21.3 ms (p99 21.3 ms) during the clear, and that delays the writers too)

out of retries (runWrite): 0
writes that failed: none
WAL written during the clear (the writers' share included): 7.8 MB
Team written back: 7,792 people in 150.5 s
Reported, not judged (#41 judges it).
```

At 7,419 links the clear holds the bench's own event loop for at most 21 ms, so the writes beside it measure the database. At 150,000 the clear's read of every link into the process will hold it longer, which this line will now show.

### The weekly smoke's steps, run here

`pnpm load:run steady --users 20 --minutes 2` (seed 407), then `node packages/load/scripts/smoke.ts 2` with `GITHUB_STEP_SUMMARY` set. With 20 users on the oversubscribed host: read p95 2.1 s, open 3.7 s, edit 3.1 s, create 9.1 s (15 samples), live delivery p95 1.2 s (23 samples), Postgres CPU p95 92% and API CPU p95 137%, 0 missed seqs, 108 × 429 (read 53, count 14, settle 41). The run was invalid on the 429s, and the script printed `::error title=Load smoke invalid::unexpected errors were 20.971%25 of actions (limit 0.1%25): 429 TOO_MANY_REQUESTS ×108`, wrote the table to the summary file and exited 2, as the workflow's step would. A valid run (exit 0 or 1) prints a warning per judged miss and exits 0 (`src/smoke.test.ts`).

### Tests and checks

- `pnpm --filter @crm/load test`: 10 files, 87 tests pass, among them the thread naming and `threadsFor`, the hub's moves, opens and renames against the fake API, `planHubEdits`, `dealPeople`, the hub lines, and the smoke's verdict and summary.
- `packages/core`'s script suites: 7 files, 59 tests pass. `seed-crm.test.ts` against a real Postgres puts the hub's Team and name back after moves off it and onto it and a rename, and plays the bench on the `test` seed (4 writers at 10 a second, 400 ms either side of the clear), checking the Team comes back to 300 and that the bench refuses while the Team isn't as seeded; `bench-hub-clear.test.ts` covers its percentiles, the writes beside the clear, the printed lines and the remote refusal (exit 3); `load-seed.test.ts` covers `--users`.
- `pnpm check` passes.

### What the runs say

- **The API is the first limit, at 100 users already, on this host.** In `hub` and `storm` the API ran at 92 to 133% of its 1 CPU cap, its pool wait p95 was 0.9 to 4.6 s, and reads, opens and edits missed their targets by 2 to 32 times; Postgres stayed at p95 70 to 79% (on a busy host). Milestone 3's quiet 50 user runs passed every judged line but the 429s, so the step from 50 to 100 users on one API process is where it bends.
- **Live delivery holds where the server does.** Commit to arrival at every subscriber stayed at p95 56 to 92 ms in `hub` and `storm` (50,200 and 133,067 arrivals), relay lag p95 47 to 83 ms, and no seq was missed in either. Commit to visible missed in `storm` (p95 1.7 s; 0.76 s in `hub`) only because the holder's refetch waited in the same saturated API.
- **The hub's contention is not what limits it at this size.** No write ran out of retries in `hub` (0 of 367) or in the bench (0 of 410), and the clear of 7,419 links took 239 ms while the writes beside it stayed at p95 47 ms. Hub renames (p95 1.3 s) and moves beside a rename (p95 2.1 s) were slow with everything else in the saturated API, not apart from it.
- **The reconnect storm at 100 users:** every user came back through Centrifugo's recovery (957 seqs replayed, 16 more caught up through the API), the last 1.13 s after the drop; the 1,000 burst edits had p95 6.8 s.
- **thousand collapses on one API process:** at 1,000 users no read, open, edit or create answered within 10 seconds (32,205 timeouts), 3,483 subscription token calls timed out so most users never subscribed (39,935 seqs never heard of), and the harness threads stalled. AC-208's run is proven to play 1,000 members across 4 threads and to judge itself invalid (exit 2); the budget at 1,000 is #41's.

### Misses and their plans

1. **429s make every run from 20 users up invalid, the weekly smoke included** (hub 2,638, storm 2,375, smoke 108; settles sent about half). The owner kept AC-203 as written on 12 October 2026, so the weekly smoke will fail as invalid until the read gate or the settle changes. **Owner's call needed:** keep the smoke failing on 429s (it then reports the read gate every Monday), or let the smoke alone report them on their line without failing (a smoke only change in `src/smoke.ts`). Plan (#41): the read gate per workspace sized to the budget, a short queue instead of a refusal, and the settle spread wider, as milestone 3's plan says.
2. **The API saturates at 100 users** (`hub`, `storm`; and at 20 on the oversubscribed host). Plan (#41): a quiet machine run of `steady` at 100 users first, then a larger API pool or a second API replica, by the numbers.
3. **`thousand` is invalid on two counts:** the API (above), and the harness's own threads, which stalled at p99 330 to 534 ms once every request timed out; 250 users fit one thread while the server answers. Plan (#41): run `thousand` with more API replicas, on a machine where Docker's caps and the harness's 4 threads fit the cores (the spec's "larger machine with the same caps"), and only then judge the budget at 1,000.
4. **Putting the Team back is slow:** 7,784 people in 100.5 s through the engine's batch write (13 ms a person: a savepoint, a link write and its share of the change event each), so the `crm` seed's 150,000 would take about 32 minutes after a bench. It is correct and goes through the engine as the spec asks. Plan (#41, only if it matters): a set based restore inside one engine write.
5. **The hub's Team holds 7,500 here, not 150,000** (the waived million seed), so the clear (239 ms, 5.1 MB of WAL with the writers') and the hub open's link total (31 ms a call) are smoke sized. A `crm` seed run of `hub` and the bench is the first thing #41 does once Docker has 12 GB.
6. **The weekly smoke's stack caps add up to 5 CPUs on a 4 CPU runner** (Postgres 2, api, worker and Centrifugo 1 each), before PgBouncer and the harness, so a harness thread's event loop can also make it invalid for reasons outside the product. Plan: watch the first runs; if the loop stalls, run the smoke at `--users 10` or on a larger runner.
7. **A shared load stack mixes lanes' numbers.** Plan: run one lane's load work at a time (now in `packages/load/AGENTS.md`); if lanes keep overlapping, a per lane project name and port offset is a small change to `docker-compose.load.yml` and `LOAD_STACK`.

### Calls made in this milestone

- **`pnpm load:seed --users N`** (1 to 1,000): the waived million seed was the only profile with 1,000 members, so `thousand` needed a small seed with more people. Additive: every profile keeps its own count by default.
- **250 users to a thread** by default (the build plan's number), each thread's event loop judged and named on its own; the sent on time share stays one share over all threads, as AC-203 reads.
- **Hub moves come from each user's own 20 people of the Team**, dealt out by a hash so no two users move the same person; each starts in the hub, so moves alternate off and back and split about evenly each way. Every user moves people whatever object its view holds (the move is the edit; the view stays the user's). The people are read through the owner login as setup, like the option ids; every measured action goes through the API.
- **A move off the hub goes to a live sampled company,** and every move is written from the person's Company: `links.add` and `links.remove` (#15) don't exist yet, and neither does the key share lock on the hub from a stored sort key (#15, #8), so `hub` measures the renames against the moves as the engine stands today.
- **The renames are kept off the mix and the edit line** (like the storm's bursts) and judged on their own line against the edit target; the moves are edits and stay on the edit line; the hub's opens stay off the open line (AC-199). A move "ran while a rename did" when their spans, from the scheduled moment to the answer, overlap. Like the storm's lines, these verdicts are for #41: `hub` exits by validity only.
- **Each rename writes a name of its own** (`Hub Company (renamed 1)`, `(renamed 2)`, ...) rather than swapping between two as AC-206 words it: after a failed round, swapping would write the name the hub already holds, a no op that reads as a fast rename. The reset puts the seed's name back either way. For the same reason a user stops moving a person whose move failed or is still in flight (it may have landed after the timeout).
- **Writes out of retries** are writes answered 503 `QUERY_CANCELLED`, which is what `runWrite` refuses with after its last attempt; they are unexpected errors too.
- **The reset puts back any seeded person's Company that moved,** not only those touching the hub, since the bench's writers also move people between other companies. Link history keeps every ended version, so the Company at `seededAt` is known exactly; nothing else the harness does writes a Company. It uses the engine's batch write (500 records, its limit) in groups of 5,000, and renames the hub back only when its name moved.
- **The reset and the bench check the manifest's ids first:** the workspace and its slug, and that the hub and every sampled company are Companies records in it, since the owner login bypasses row level security.
- **The bench runs as the system actor through the engine, without the access door,** like the reset (engine level, AC-214). It refuses while the Team isn't as seeded, lets the writers run alone 10 seconds before the clear and 10 after, picks seeded people outside the hub whose company is live (so the reset can link them back), and writes the Team back even when the clear fails.
- **The weekly smoke wipes its throwaway stack at the end** and uploads only `.load/results/`; a crash or a refused setup fails it with that exit code, and so does a missing result file.
- **The hub open reads the whole record** (`records.get` with no `attributeIds`), which is what a record page reads.

### Owner decisions recorded

- The million record seed run stays waived (12 October 2026): every milestone 4 run is on the smoke seed, here with 1,000 members.
- A 429 stays an unexpected error (12 October 2026), which makes the weekly smoke fail as invalid today; miss 1 asks whether the smoke alone should treat them otherwise.
- Docker stays at 7.75 GB: the stack is started with `docker compose` directly, and every run fits within it.

### Owner steps

- Decide miss 1 (the weekly smoke and 429s) before the first Monday run, or expect it to fail as invalid until #41 changes the read gate.

### Reviews (milestone 4)

`security-access-reviewer` and `state-performance-reviewer` on b7cefb0..203073a. Fixed in the commit after it:

- **Security, low:** the owner login bypasses row level security, and the manifest's `hubCompanyId` and sampled companies were never checked against the workspace. `assertSeededWorkspace` now refuses (exit 3) unless every one is a Companies record in the seeded workspace; tested. A stronger step, running the reset's and the bench's engine writes through a login without `bypassrls`, is left for #41 (the erase already ran this way before this milestone).
- **Security, low:** the smoke's checkout kept the token on disk; it now sets `persist-credentials: false` (the other workflows do the same as before; a repo wide change, not this one).
- **Performance, medium:** the bench's writes beside the clear could hide the bench's own event loop stall; the clear now measures it and the bench prints it, with a note that the writers meet the pool, CPU and WAL, not the cleared rows' locks.
- **Performance, medium low:** the bench left its link churn unvacuumed; it now vacuums after the write back, as the reset does.
- **Performance, low:** the moves beside a rename only overlap in time today (no shared lock until #15's and #8's key share lock); the line's note says so. A failed or in flight move no longer leaves a person to be moved again into a no op, and each rename writes a new name.
- **Performance, low:** `writes out of retries` now says it counts 503 `QUERY_CANCELLED` on a write, mostly `runWrite`'s; an empty exit code reaching `smoke.ts` is a crash, never a clean exit.

Not changed: the weekly smoke failing on 429s (miss 1, the owner's call); the sent on time share judged over all threads together (AC-203 reads one share, and each thread's loop is judged on its own); `movedPeople`'s full pass over People's Company links (a few seconds at the million, once per reset).
