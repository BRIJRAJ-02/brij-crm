// The record store's prototype gate (AC-40, spec 0005): builds the harness
// with React's production build, opens it in Chromium through Playwright,
// and measures each source over 100,000 records: the grid's own baseline,
// the baseline while the page holds every record (a control), the plain
// store and the TanStack DB store. Each source gets its own browser, so
// heaps never mix.
//
//   pnpm --filter @crm/data gate                        every source, once
//   pnpm --filter @crm/data gate --rounds=5             five rounds, every source in each
//   pnpm --filter @crm/data gate plain tanstack         only those (the two controls always run)
//   pnpm --filter @crm/data gate --out=results.json     also writes every round as JSON
//
// A busy machine moves frame times for every source alike, so each round
// runs every source back to back, in an order that rotates each round, and
// each store is judged against the controls from its own round: frames
// against `baseline`, memory against `held`. It prints the medians with their
// range, the per round differences from the controls, and the load average
// before, between and after the rounds.
import { layerOrder, uiVite } from '@crm/ui/vite';
import react from '@vitejs/plugin-react';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism, loadavg, tmpdir } from 'node:os';
import path from 'node:path';
import { chromium, type Page } from 'playwright';
import { build, preview } from 'vite';
import type { EditResults, FrameStats, GateKind } from './harness/main.tsx';

const HARNESS = path.join(import.meta.dirname, 'harness');
const KINDS: readonly GateKind[] = ['baseline', 'held', 'plain', 'tanstack'];
/** The controls: every round runs them, and each store is judged against them. */
const CONTROLS: readonly GateKind[] = ['baseline', 'held'];
/** The fake server's answer time for one block, in ms. */
const LATENCY_MS = 20;
/** A brisk trackpad or wheel scroll: 1,500 px a second, about 45 rows. */
const NORMAL_SCROLL = { seconds: 6, pixelsPerSecond: 1500 };
const PATCH_RUNS = 30;
const MB = 1024 * 1024;

interface Result {
  readonly kind: GateKind;
  readonly firstPaintMs: number;
  readonly heapAfterMountMb: number;
  readonly normalScroll: FrameStats;
  readonly stepScroll: FrameStats;
  readonly wholeScroll: { readonly ms: number; readonly storeSize: number; readonly blocksLoaded: number };
  readonly heapAfterWholeMb: number;
  readonly normalScrollFull: FrameStats;
  readonly patch?: {
    readonly storeMedianMs: number;
    readonly storeMaxMs: number;
    readonly renderedMedianMs: number;
    readonly renderedMaxMs: number;
  };
  readonly edits?: EditResults;
}

/** The middle value (the mean of the two middle ones for an even count). */
function median(values: readonly number[]): number {
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  const upper = ordered[middle] ?? 0;
  return ordered.length % 2 === 0 ? ((ordered[middle - 1] ?? upper) + upper) / 2 : upper;
}
const fixed = (value: number, digits = 1) => value.toFixed(digits);

/** The JS heap in use after a full garbage collection, in MB. */
async function heapMb(page: Page): Promise<number> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.collectGarbage');
  await cdp.send('HeapProfiler.collectGarbage');
  const { usedSize } = await cdp.send('Runtime.getHeapUsage');
  await cdp.detach();
  return usedSize / MB;
}

async function measure(url: string, kind: GateKind): Promise<Result> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on('pageerror', (error) => {
      process.stderr.write(`[${kind}] page error: ${error.message}\n`);
    });
    await page.goto(url);
    await page.waitForFunction(() => window.gate !== undefined);
    const firstPaintMs = await page.evaluate(async ([which, latency]) => window.gate?.mount(which, latency) ?? 0, [
      kind,
      LATENCY_MS,
    ] as const);
    const heapAfterMountMb = await heapMb(page);
    const normalScroll = await page.evaluate(async ({ seconds, pixelsPerSecond }) => {
      const gate = window.gate;
      if (gate === undefined) throw new Error('No gate.');
      return gate.scrollSmooth(seconds, pixelsPerSecond);
    }, NORMAL_SCROLL);
    const stepScroll = await page.evaluate(async () => {
      const gate = window.gate;
      if (gate === undefined) throw new Error('No gate.');
      return gate.scrollSteps(60, 3000);
    });
    const wholeScroll = await page.evaluate(async () => {
      const gate = window.gate;
      if (gate === undefined) throw new Error('No gate.');
      return gate.scrollWhole();
    });
    const heapAfterWholeMb = await heapMb(page);
    await page.evaluate(() => {
      const grid = document.querySelector('[role="grid"]');
      if (grid !== null) grid.scrollTop = 0;
    });
    const normalScrollFull = await page.evaluate(async ({ seconds, pixelsPerSecond }) => {
      const gate = window.gate;
      if (gate === undefined) throw new Error('No gate.');
      return gate.scrollSmooth(seconds, pixelsPerSecond);
    }, NORMAL_SCROLL);
    if (kind === 'baseline' || kind === 'held') {
      return {
        kind,
        firstPaintMs,
        heapAfterMountMb,
        normalScroll,
        stepScroll,
        wholeScroll,
        heapAfterWholeMb,
        normalScrollFull,
      };
    }
    const patched = await page.evaluate(async (runs) => {
      const gate = window.gate;
      if (gate === undefined) throw new Error('No gate.');
      return gate.patch(runs);
    }, PATCH_RUNS);
    const edits = await page.evaluate(async () => {
      const gate = window.gate;
      if (gate === undefined) throw new Error('No gate.');
      return gate.edits();
    });
    return {
      kind,
      firstPaintMs,
      heapAfterMountMb,
      normalScroll,
      stepScroll,
      wholeScroll,
      heapAfterWholeMb,
      normalScrollFull,
      patch: {
        storeMedianMs: median(patched.storeMs),
        storeMaxMs: Math.max(...patched.storeMs),
        renderedMedianMs: median(patched.renderedMs),
        renderedMaxMs: Math.max(...patched.renderedMs),
      },
      edits,
    };
  } finally {
    await browser.close();
  }
}

/** Median, with the range when there was more than one run. */
function spread(values: readonly number[], digits = 1): string {
  const middle = fixed(median(values), digits);
  if (values.length < 2) return middle;
  return `${middle} (${fixed(Math.min(...values), digits)} to ${fixed(Math.max(...values), digits)})`;
}

/** "yes" when the check held in every run, else how many runs it held in. */
function always(values: readonly boolean[]): string {
  const held = values.filter(Boolean).length;
  return held === values.length ? 'yes' : `no (${String(held)} of ${String(values.length)})`;
}

type Cell = (runs: readonly Result[]) => string;
const each =
  (pick: (result: Result) => number | undefined, digits = 1): Cell =>
  (runs) => {
    const values = runs.map(pick).filter((value): value is number => value !== undefined);
    return values.length === 0 ? 'n/a' : spread(values, digits);
  };
const check =
  (pick: (edits: EditResults) => boolean): Cell =>
  (runs) => {
    const values = runs.flatMap((result) => (result.edits === undefined ? [] : [pick(result.edits)]));
    return values.length === 0 ? 'n/a' : always(values);
  };

/** The median of each measure over the runs, one column per source. */
function table(byKind: ReadonlyMap<GateKind, readonly Result[]>): string {
  const rows: readonly (readonly [string, Cell])[] = [
    ['First paint (ms)', each((r) => r.firstPaintMs)],
    ['JS heap after mount (MB)', each((r) => r.heapAfterMountMb)],
    ['Normal scroll, fresh view: frames over 25 ms', each((r) => r.normalScroll.dropped, 0)],
    ['Normal scroll, fresh view: mean frame (ms)', each((r) => r.normalScroll.meanMs)],
    ['Normal scroll, fresh view: p95 frame (ms)', each((r) => r.normalScroll.p95Ms)],
    ['Normal scroll, fresh view: long tasks', each((r) => r.normalScroll.longTasks.length, 0)],
    ['AC-7 step scroll: long tasks', each((r) => r.stepScroll.longTasks.length, 0)],
    ['AC-7 step scroll: longest task (ms)', each((r) => Math.max(0, ...r.stepScroll.longTasks), 0)],
    ['AC-7 step scroll: most rows in the DOM', each((r) => r.stepScroll.mostRowsInDom, 0)],
    ['Whole table scrolled, block by block (s)', each((r) => r.wholeScroll.ms / 1000)],
    ['Records held after it', each((r) => r.wholeScroll.storeSize, 0)],
    ['Blocks of ids kept after it', each((r) => r.wholeScroll.blocksLoaded, 0)],
    ['JS heap after the whole table (MB)', each((r) => r.heapAfterWholeMb)],
    ['Normal scroll, every record held: frames over 25 ms', each((r) => r.normalScrollFull.dropped, 0)],
    ['Normal scroll, every record held: mean frame (ms)', each((r) => r.normalScrollFull.meanMs)],
    ['Patch 50, store and notice: median (ms)', each((r) => r.patch?.storeMedianMs, 2)],
    ['Patch 50, store and notice: worst (ms)', each((r) => r.patch?.storeMaxMs, 2)],
    ['Patch 50, store and grid render: median (ms)', each((r) => r.patch?.renderedMedianMs, 2)],
    ['Patch 50, store and grid render: worst (ms)', each((r) => r.patch?.renderedMaxMs, 2)],
    ['Edit apply and render (ms)', each((r) => r.edits?.applyMs, 2)],
    ['Rollback and render (ms)', each((r) => r.edits?.rollbackMs, 2)],
    ['Edit shows on screen', check((e) => e.appliedOnScreen)],
    ['Rollback exact, in the store and on screen', check((e) => e.rollbackExact && e.rollbackOnScreen)],
    ['Confirmation keeps a second edit to the same cell', check((e) => e.secondEditKept)],
    ['Confirmation keeps a second edit to another cell, on the new base', check((e) => e.secondEditKeptOtherCell)],
    ['Refusal keeps a later edit on the same record', check((e) => e.refusalKeepsLaterLayer)],
  ];
  const kinds = [...byKind.keys()];
  const head = `| Measure | ${kinds.join(' | ')} |\n|---|${kinds.map(() => '---').join('|')}|`;
  return [
    head,
    ...rows.map(([label, cell]) => `| ${label} | ${kinds.map((kind) => cell(byKind.get(kind) ?? [])).join(' | ')} |`),
  ].join('\n');
}

/** A difference from a control in the same round, one column per source. */
type Versus = (result: Result, control: { readonly baseline: Result; readonly held: Result }) => number | undefined;

/** Each source's difference from the controls, worked out per round, then the median (and range) over the rounds. */
function versusTable(rounds: readonly ReadonlyMap<GateKind, Result>[], kinds: readonly GateKind[]): string {
  const rows: readonly (readonly [string, Versus, number])[] = [
    [
      'Normal scroll, fresh view: frames over 25 ms, minus baseline',
      (r, c) => r.normalScroll.dropped - c.baseline.normalScroll.dropped,
      0,
    ],
    [
      'Normal scroll, fresh view: mean frame, minus baseline (ms)',
      (r, c) => r.normalScroll.meanMs - c.baseline.normalScroll.meanMs,
      2,
    ],
    [
      'Normal scroll, fresh view: p95 frame, minus baseline (ms)',
      (r, c) => r.normalScroll.p95Ms - c.baseline.normalScroll.p95Ms,
      1,
    ],
    [
      'Normal scroll, every record held: frames over 25 ms, minus baseline',
      (r, c) => r.normalScrollFull.dropped - c.baseline.normalScrollFull.dropped,
      0,
    ],
    [
      // Held is the fairer control here: it holds the same 100,000 records, so the heap is the same size.
      'Normal scroll, every record held: frames over 25 ms, minus held',
      (r, c) => r.normalScrollFull.dropped - c.held.normalScrollFull.dropped,
      0,
    ],
    [
      'Normal scroll, every record held: mean frame, minus baseline (ms)',
      (r, c) => r.normalScrollFull.meanMs - c.baseline.normalScrollFull.meanMs,
      2,
    ],
    [
      'AC-7 step scroll: long tasks, minus baseline',
      (r, c) => r.stepScroll.longTasks.length - c.baseline.stepScroll.longTasks.length,
      0,
    ],
    [
      'JS heap after the whole table, minus baseline (MB)',
      (r, c) => r.heapAfterWholeMb - c.baseline.heapAfterWholeMb,
      1,
    ],
    [
      'JS heap after the whole table, minus held (MB): the store’s own cost',
      (r, c) => r.heapAfterWholeMb - c.held.heapAfterWholeMb,
      1,
    ],
  ];
  const cell = (kind: GateKind, versus: Versus, digits: number) => {
    const values = rounds.flatMap((round) => {
      const result = round.get(kind);
      const baseline = round.get('baseline');
      const held = round.get('held');
      if (result === undefined || baseline === undefined || held === undefined) return [];
      const value = versus(result, { baseline, held });
      return value === undefined ? [] : [value];
    });
    return values.length === 0 ? 'n/a' : spread(values, digits);
  };
  const others = kinds.filter((kind) => kind !== 'baseline');
  const head = `| Against the controls, per round | ${others.join(' | ')} |\n|---|${others.map(() => '---').join('|')}|`;
  return [
    head,
    ...rows.map(
      ([label, versus, digits]) => `| ${label} | ${others.map((kind) => cell(kind, versus, digits)).join(' | ')} |`,
    ),
  ].join('\n');
}

/** TanStack DB's timings over the plain store's from the same round, as a ratio. */
function headToHead(rounds: readonly ReadonlyMap<GateKind, Result>[]): string {
  const rows: readonly (readonly [string, (result: Result) => number | undefined])[] = [
    ['Patch 50, store and grid render: median', (r) => r.patch?.renderedMedianMs],
    ['Patch 50, store and notice: median', (r) => r.patch?.storeMedianMs],
    ['Edit apply and render', (r) => r.edits?.applyMs],
    ['Rollback and render', (r) => r.edits?.rollbackMs],
    ['Whole table scrolled, block by block', (r) => r.wholeScroll.ms],
  ];
  const lines = rows.flatMap(([label, pick]) => {
    const ratios = rounds.flatMap((round) => {
      const plain = round.get('plain');
      const tanstack = round.get('tanstack');
      if (plain === undefined || tanstack === undefined) return [];
      const a = pick(plain);
      const b = pick(tanstack);
      return a === undefined || b === undefined || a === 0 ? [] : [b / a];
    });
    return ratios.length === 0 ? [] : [`| ${label} | ${spread(ratios, 2)} |`];
  });
  return lines.length === 0 ? '' : ['| TanStack DB over plain, per round | ratio |', '|---|---|', ...lines].join('\n');
}

const loads = () =>
  loadavg()
    .map((each) => fixed(each, 2))
    .join(' ');

const args = process.argv.slice(2);
const named = args.filter((arg): arg is GateKind => (KINDS as readonly string[]).includes(arg));
const kinds = named.length === 0 ? KINDS : KINDS.filter((kind) => CONTROLS.includes(kind) || named.includes(kind));
const option = (name: string) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const roundCount = Number(option('rounds') ?? option('runs') ?? '1');
const outFile = option('out');
const outDir = mkdtempSync(path.join(tmpdir(), 'crm-gate-'));
try {
  await build({
    root: HARNESS,
    configFile: false,
    mode: 'production',
    logLevel: 'error',
    plugins: [react(), uiVite(), layerOrder()],
    build: { outDir, emptyOutDir: true },
  });
  const server = await preview({
    root: HARNESS,
    configFile: false,
    logLevel: 'warn',
    build: { outDir },
    preview: { port: 0 },
  });
  const url = server.resolvedUrls?.local[0];
  if (url === undefined) throw new Error('The preview server has no address.');
  const machine = { cpus: availableParallelism(), loadAtStart: loads(), loadAfterRound: [] as string[], loadAtEnd: '' };
  const rounds: Map<GateKind, Result>[] = [];
  for (let round = 0; round < roundCount; round += 1) {
    // The order rotates each round, so no source always runs first, or always right after the same one.
    const order = kinds
      .map((_, at) => kinds[(at + round) % kinds.length])
      .filter((kind): kind is GateKind => kind !== undefined);
    const results = new Map<GateKind, Result>();
    for (const kind of order) {
      process.stderr.write(`Round ${String(round + 1)} of ${String(roundCount)}: ${kind} (load ${loads()})\n`);
      results.set(kind, await measure(url, kind));
    }
    rounds.push(results);
    machine.loadAfterRound.push(loads());
  }
  machine.loadAtEnd = loads();
  await server.close();
  const byKind = new Map(kinds.map((kind) => [kind, rounds.flatMap((round) => round.get(kind) ?? [])] as const));
  const report = [
    `${String(roundCount)} round(s) on ${String(machine.cpus)} cores. Load average (1, 5, 15 min): ${machine.loadAtStart} at the start, ${machine.loadAtEnd} at the end; after each round: ${machine.loadAfterRound.join('; ')}.`,
    'Medians over the rounds, with the range in brackets.',
    table(byKind),
    versusTable(rounds, kinds),
    headToHead(rounds),
  ].filter((part) => part !== '');
  process.stdout.write(`\n${report.join('\n\n')}\n`);
  if (outFile !== undefined) {
    writeFileSync(
      outFile,
      `${JSON.stringify({ machine, rounds: rounds.map((round) => Object.fromEntries(round)) }, undefined, 2)}\n`,
    );
  }
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
