// Measures one page switch in the running app: from the click to the first frame its content shows, whether a
// skeleton (or an empty body) showed on the way, and every layout shift meanwhile, read from the page's own
// PerformanceObserver and a frame by frame probe. With FLOW_STRIPS naming a folder, it also keeps the frames
// Chromium painted (its screencast), one picture per change, for a strip of the switch.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, type BrowserContext, type CDPSession, type Locator, type Page, type Route } from '@playwright/test';

/** What one switch looked like. */
export interface Switch {
  readonly name: string;
  /** From the click to the first frame with the content, in ms. */
  readonly contentMs: number;
  /** Frames a skeleton was on screen. */
  readonly skeletonFrames: number;
  /** Frames the page's body was empty (no skeleton, no content) after the click. */
  readonly blankFrames: number;
  /** Every layout shift from the click until settled, with or without recent input. */
  readonly shift: number;
  /** The shifts' sources, for the report. */
  readonly shiftSources: readonly string[];
  /** Script chunks and API calls asked for after the click. */
  readonly requests: readonly string[];
}

const PROBE = () => {
  interface Probe {
    start: number;
    frames: { t: number; skeleton: number; body: number; ready: boolean }[];
    shifts: { t: number; value: number; sources: string[] }[];
    ready: () => boolean;
    on: boolean;
  }
  const w = window as unknown as { __switch?: Probe };
  if (w.__switch !== undefined) return;
  const probe: Probe = { start: 0, frames: [], shifts: [], ready: () => false, on: false };
  w.__switch = probe;
  new PerformanceObserver((list) => {
    if (!probe.on) return;
    for (const entry of list.getEntries() as unknown as {
      startTime: number;
      value: number;
      sources?: { node?: Node | null }[];
    }[]) {
      probe.shifts.push({
        t: entry.startTime - probe.start,
        value: entry.value,
        sources: (entry.sources ?? []).map((source) => {
          const node = source.node;
          if (!(node instanceof Element)) return node?.nodeName ?? '?';
          return `${node.tagName.toLowerCase()}.${[...node.classList].join('.')}`;
        }),
      });
    }
  }).observe({ type: 'layout-shift', buffered: false });
  const tick = () => {
    if (probe.on) {
      const main = document.querySelector('main');
      probe.frames.push({
        t: performance.now() - probe.start,
        skeleton: [...document.querySelectorAll('[data-shape][aria-hidden="true"]')].filter(
          (element) => element.getBoundingClientRect().height > 0,
        ).length,
        body: (main?.textContent ?? '').trim().length,
        ready: probe.ready(),
      });
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

/** Puts the probe on every page the context opens. Call once, before the first navigation. */
export async function installProbe(page: Page): Promise<void> {
  await page.addInitScript(PROBE);
}

/** Network conditions: Chrome's Fast 3G, or none. */
export async function throttle(cdp: CDPSession, kind: 'fast-3g' | 'none'): Promise<void> {
  await cdp.send('Network.enable');
  await cdp.send(
    'Network.emulateNetworkConditions',
    kind === 'none'
      ? { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }
      : {
          offline: false,
          latency: 562.5,
          downloadThroughput: (1.6 * 1024 * 1024 * 0.9) / 8,
          uploadThroughput: (750 * 1024 * 0.9) / 8,
        },
  );
}

/**
 * Hovers `target` for a beat as a person does (so intent preloading has its chance), clicks it, and waits for
 * `ready`; then watches 800 ms more for late skeletons and shifts. `readyCss` and `readyText` name the content
 * for the in page probe: an element matching the selector whose text holds the words.
 */
export async function measureSwitch(
  page: Page,
  cdp: CDPSession,
  name: string,
  target: Locator,
  ready: Locator,
  probeReady: { readonly css: string; readonly text?: string },
  options: { readonly hoverMs?: number; readonly strips?: string } = {},
): Promise<Switch> {
  const requests: string[] = [];
  const onRequest = (request: { url: () => string }) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/assets/') && url.pathname.endsWith('.js')) requests.push(url.pathname.slice(8));
    else if (url.pathname.startsWith('/api/rpc/')) requests.push(url.pathname.slice(9));
  };
  const frames: { at: number; data: string }[] = [];
  const onFrame = (frame: { data: string; sessionId: number; metadata: { timestamp?: number } }) => {
    frames.push({ at: (frame.metadata.timestamp ?? 0) * 1000, data: frame.data });
    void cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => undefined);
  };
  await target.hover();
  await page.waitForTimeout(options.hoverMs ?? 150);
  if (options.strips !== undefined) {
    cdp.on('Page.screencastFrame', onFrame);
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 60, everyNthFrame: 1, maxWidth: 640 });
  }
  page.on('request', onRequest);
  const clickedAt = Date.now();
  await page.evaluate(
    ({ css, text }) => {
      const probe = (
        window as unknown as {
          __switch: { start: number; frames: unknown[]; shifts: unknown[]; ready: () => boolean; on: boolean };
        }
      ).__switch;
      probe.frames = [];
      probe.shifts = [];
      probe.ready = () =>
        [...document.querySelectorAll(css)].some(
          (element) =>
            element.getBoundingClientRect().height > 0 && (text === undefined || element.textContent.includes(text)),
        );
      probe.start = performance.now();
      probe.on = true;
    },
    { css: probeReady.css, text: probeReady.text },
  );
  await target.click();
  await ready.first().waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForTimeout(800);
  const result = await page.evaluate(() => {
    const probe = (
      window as unknown as {
        __switch: {
          on: boolean;
          frames: { t: number; skeleton: number; body: number; ready: boolean }[];
          shifts: { t: number; value: number; sources: string[] }[];
        };
      }
    ).__switch;
    probe.on = false;
    return { frames: probe.frames, shifts: probe.shifts };
  });
  page.off('request', onRequest);
  if (options.strips !== undefined) {
    await cdp.send('Page.stopScreencast');
    cdp.off('Page.screencastFrame', onFrame);
    const folder = path.join(options.strips, name.replace(/[^a-z0-9]+/gi, '-').toLowerCase());
    mkdirSync(folder, { recursive: true });
    frames.forEach((frame, index) => {
      const ms = Math.max(0, Math.round(frame.at - clickedAt));
      writeFileSync(
        path.join(folder, `${String(index).padStart(3, '0')}-${String(ms).padStart(5, '0')}ms.jpg`),
        Buffer.from(frame.data, 'base64'),
      );
    });
  }
  const firstReady = result.frames.find((frame) => frame.ready);
  const contentMs = firstReady === undefined ? Number.NaN : Math.round(firstReady.t);
  const beforeReady = result.frames.filter((frame) => firstReady === undefined || frame.t <= firstReady.t);
  return {
    name,
    contentMs,
    skeletonFrames: result.frames.filter((frame) => frame.skeleton > 0).length,
    blankFrames: beforeReady.filter((frame) => frame.skeleton === 0 && frame.body === 0).length,
    shift: Number(result.shifts.reduce((sum, each) => sum + each.value, 0).toFixed(4)),
    shiftSources: [...new Set(result.shifts.flatMap((each) => each.sources))],
    requests,
  };
}

/** The workspace the switching flows run in: a booking page, a form and a person, so every screen has a row. */
export interface SwitchingWorkspace {
  readonly slug: string;
  readonly recordId: string;
}

/**
 * The flows' workspace: made through the app (`make` signs a new person in through Mailpit), or, with FLOW_STATE
 * and FLOW_SLUG, one made before, signed in from its saved state. Either way it gets Grace Hopper, the Intro call
 * booking page and a form when it lacks them.
 */
export async function switchingWorkspace(
  page: Page,
  make: (page: Page) => Promise<string>,
  addPerson: (page: Page) => Promise<void>,
): Promise<SwitchingWorkspace> {
  const state = process.env.FLOW_STATE;
  let slug = process.env.FLOW_SLUG;
  if (state !== undefined && slug !== undefined) {
    const saved = JSON.parse(readFileSync(state, 'utf8')) as { cookies: Parameters<BrowserContext['addCookies']>[0] };
    await page.context().addCookies(saved.cookies);
  } else {
    slug = await make(page);
  }
  const has = (text: string) =>
    page
      .getByText(text, { exact: true })
      .first()
      .waitFor({ timeout: 40_000 })
      .then(
        () => true,
        () => false,
      );
  await page.goto(`/w/${slug}/objects/people`);
  if (!(await has('Grace Hopper'))) await addPerson(page);
  await page
    .getByRole('rowheader', { name: /Grace Hopper/ })
    .first()
    .getByText('Grace Hopper')
    .click();
  await expect(page).toHaveURL(/\/objects\/people\/[0-9a-f-]{36}\/overview$/, { timeout: 30_000 });
  const recordId = /\/people\/([0-9a-f-]{36})\//.exec(page.url())?.[1] ?? '';
  await page.goto(`/w/${slug}/captures/links`);
  if (!(await has('Intro call'))) {
    await page.getByRole('button', { name: 'New booking page' }).first().click();
    await page.getByLabel('Title').fill('Intro call');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page).toHaveURL(/captures\/links\/[0-9a-f-]{36}/, { timeout: 60_000 });
  }
  await page.goto(`/w/${slug}/captures/forms`);
  if (!(await has('Untitled form'))) {
    await page.getByRole('button', { name: 'New form' }).first().click();
    await expect(page).toHaveURL(/captures\/forms\/[0-9a-f-]{36}/, { timeout: 60_000 });
  }
  return { slug, recordId };
}

/** One region's place on screen. */
export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The page's main regions, by what draws them: the TopBar, the tab strip, the Toolbar, the page column (with its
 * main and aside), the tab panel, a settings page's header and body, an editor's cards and preview, a record's
 * header and details, a list of links and the week. A region absent from the page is left out.
 */
export const REGIONS = {
  topBar: 'main .ws-toolbar-top',
  tabs: 'main [role="tablist"]',
  toolbar: 'main .ws-toolbar-toolbar',
  column: 'main .ws-page-column-root',
  columnMain: 'main .ws-page-column-main',
  aside: 'main .ws-page-column-aside',
  panel: 'main [role="tabpanel"]',
  settingsHeader: 'main .ws-settings-layout-header',
  settingsBody: 'main .ws-settings-layout-body',
  editorMain: 'main .ws-preview-layout-main',
  editorPreview: 'main .ws-preview-layout-side',
  recordHeader: 'main .ws-record-layout-header',
  recordSidebar: 'main .ws-record-layout-sidebar',
  list: 'main .ws-link-list-root',
  grid: 'main .ws-link-grid-grid',
  week: 'main .ws-week-calendar-root',
} as const;

/** Regions whose height is the layout's own (bars); the others grow with what they hold, so only their place counts. */
export const FIXED_HEIGHT: ReadonlySet<string> = new Set([
  'topBar',
  'tabs',
  'toolbar',
  'settingsHeader',
  'recordHeader',
]);

/** Where each region is now, and the page column's width variant. */
export async function regionsOf(page: Page): Promise<{ boxes: Record<string, Box>; width?: string }> {
  return page.evaluate((regions) => {
    // The first one drawn: while a pending page shows, the page it replaces stays in the document, hidden.
    const shown = (selector: string) =>
      [...document.querySelectorAll(selector)].filter((element) => {
        const box = element.getBoundingClientRect();
        return box.width > 0 || box.height > 0;
      });
    const place = (element: Element) => {
      const box = element.getBoundingClientRect();
      return {
        x: Math.round(box.x),
        y: Math.round(box.y),
        width: Math.round(box.width),
        height: Math.round(box.height),
      };
    };
    const boxes: Record<string, { x: number; y: number; width: number; height: number }> = {};
    for (const [name, selector] of Object.entries(regions)) {
      const [element] = shown(selector);
      if (element !== undefined) boxes[name] = place(element);
    }
    // The first three cards in reading order, each by its place: a card the skeleton left out moves the rest.
    shown('main .ws-card-root')
      .slice(0, 3)
      .forEach((card, index) => {
        boxes[`card${String(index + 1)}`] = place(card);
      });
    const width = shown('main .ws-page-column-root')[0]?.getAttribute('data-width') ?? undefined;
    return { boxes, ...(width === undefined ? {} : { width }) };
  }, REGIONS);
}

/** How a skeleton's regions differ from the loaded page's, beyond `tolerance` px: one line per difference. */
export function shapeDifferences(
  skeleton: { boxes: Record<string, Box>; width?: string },
  loaded: { boxes: Record<string, Box>; width?: string },
  tolerance = 4,
): string[] {
  const found: string[] = [];
  if (skeleton.width !== loaded.width) found.push(`column width ${String(skeleton.width)} → ${String(loaded.width)}`);
  for (const [name, box] of Object.entries(loaded.boxes)) {
    const shown = skeleton.boxes[name];
    if (shown === undefined) {
      found.push(`${name} missing from the skeleton`);
      continue;
    }
    // A card's height, and so the place of the cards after it, follows what it holds (three loading rows, one task):
    // a card is held to being there, at its place across the page.
    const keys = FIXED_HEIGHT.has(name)
      ? (['x', 'y', 'width', 'height'] as const)
      : name.startsWith('card')
        ? (['x', 'width'] as const)
        : (['x', 'y', 'width'] as const);
    for (const key of keys) {
      if (Math.abs(shown[key] - box[key]) > tolerance)
        found.push(`${name}.${key} ${String(shown[key])} → ${String(box[key])}`);
    }
  }
  for (const name of Object.keys(skeleton.boxes)) {
    if (loaded.boxes[name] === undefined) found.push(`${name} only in the skeleton`);
  }
  return found;
}

/** The page's outline, four levels under its frame, each element by tag, class and size: for reading a mismatch. */
async function outline(page: Page): Promise<string> {
  return page.evaluate(() => {
    const lines: string[] = [];
    const walk = (element: Element, depth: number) => {
      if (depth > 11) return;
      const box = element.getBoundingClientRect();
      lines.push(
        `${'  '.repeat(depth)}${element.tagName.toLowerCase()}.${[...element.classList].join('.')} ${String(Math.round(box.x))},${String(Math.round(box.y))} ${String(Math.round(box.width))}x${String(Math.round(box.height))}`,
      );
      for (const child of element.children) walk(child, depth + 1);
    };
    const root = document.querySelector('[data-app-root]') ?? document.body;
    walk(root, 0);
    return lines.join('\n');
  });
}

/** The workspace frame's reads, which a move between its pages never waits on. */
const FRAME_READS = /^\/api\/rpc\/(me|realtime|access\/mine|objects\/list)(\/|$)/;

/**
 * Moves to a page the way a person does (`go` clicks a link, a tab or a row) with the page's API calls held, so its
 * loading state shows; answers its regions once a skeleton is up (undefined when none came, the page having all it
 * needed already), then lets the calls through and answers the loaded page's regions.
 */
export async function loadingAndLoaded(
  page: Page,
  go: () => Promise<void>,
  shots?: string,
): Promise<{ skeleton?: Awaited<ReturnType<typeof regionsOf>>; loaded: Awaited<ReturnType<typeof regionsOf>> }> {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  // The frame's own reads (who is signed in, the live head, the objects and access the sidebar already shows) pass;
  // only the page's reads wait, as when a person moves between pages of a workspace already open.
  const held: Promise<void>[] = [];
  const hold = (route: Route) => {
    const passed = (async () => {
      if (!FRAME_READS.test(new URL(route.request().url()).pathname)) await gate;
      await route.continue().catch(() => undefined);
    })();
    held.push(passed);
    return passed;
  };
  await page.route('**/api/rpc/**', hold);
  await go();
  // A skeleton, or a region drawn busy in its own shape (the week's grid while its blocks load).
  const skeletonShown = await page
    .locator('main [data-shape][aria-hidden="true"], main [aria-busy="true"]')
    .first()
    .waitFor({ state: 'visible', timeout: 3_000 })
    .then(
      () => true,
      () => false,
    );
  let skeleton: Awaited<ReturnType<typeof regionsOf>> | undefined;
  if (skeletonShown) {
    await page.waitForTimeout(300);
    skeleton = await regionsOf(page);
    if (shots !== undefined) {
      await page.screenshot({ path: `${shots}-loading.png` });
      writeFileSync(`${shots}-loading.txt`, await outline(page));
    }
  }
  release();
  await Promise.all(held);
  await page.unroute('**/api/rpc/**', hold);
  // Loaded once no skeleton is left, or once the calls settle (a grid keeps a cell's skeleton for a value it reads on).
  await Promise.race([
    page.locator('main [data-shape][aria-hidden="true"]').first().waitFor({ state: 'hidden', timeout: 15_000 }),
    page.waitForLoadState('networkidle', { timeout: 15_000 }),
  ]).catch(() => undefined);
  await page.waitForTimeout(1_000);
  const loaded = await regionsOf(page);
  if (shots !== undefined) {
    await page.screenshot({ path: `${shots}-loaded.png` });
    writeFileSync(`${shots}-loaded.txt`, await outline(page));
  }
  return { ...(skeleton === undefined ? {} : { skeleton }), loaded };
}
