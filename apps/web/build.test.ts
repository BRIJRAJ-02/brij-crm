// Builds the app the way Vercel does and checks the CSS that ships: the cascade
// layer order survives Vite's @import inlining (AC-5, AC-12), and the fonts are
// same origin files under /assets/, never data: URIs the CSP would refuse (AC-11).
// It also checks the first load (spec 0003, AC-18): the heavy library entries
// (grid, editor, charts, schema map) never sit in index.html's static graph.
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { firstLoad, type Manifest } from './first-load.ts';
import { servedOnPublicHost } from './public-paths.ts';

const ROOT = import.meta.dirname;
const outDir = mkdtempSync(path.join(tmpdir(), 'crm-web-build-'));
let assets: string[] = [];
let css = '';
let html = '';
let linked: string[] = [];
let manifest: Manifest = {};

beforeAll(async () => {
  await build({
    root: ROOT,
    configFile: path.join(ROOT, 'vite.config.ts'),
    logLevel: 'silent',
    // The real config's source maps too: hidden, then deleted (AC-164).
    build: { outDir, emptyOutDir: true },
  });
  assets = readdirSync(path.join(outDir, 'assets'));
  html = readFileSync(path.join(outDir, 'index.html'), 'utf8');
  manifest = JSON.parse(readFileSync(path.join(outDir, '.vite', 'manifest.json'), 'utf8')) as Manifest;
  // In the order a browser meets them: the stylesheets index.html links, then
  // the ones lazy chunks bring.
  linked = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="\/([^"]+\.css)"/g)].map((match) => match[1] ?? '');
  const rest = assets.map((file) => `assets/${file}`).filter((file) => file.endsWith('.css') && !linked.includes(file));
  css = [...linked, ...rest].map((file) => readFileSync(path.join(outDir, file), 'utf8')).join('\n');
}, 120_000);

afterAll(() => {
  rmSync(outDir, { recursive: true, force: true });
});

describe('the built stylesheet', () => {
  // Browsers order layers by first appearance. The minifier (Lightning CSS) may
  // fold the order statement into the blocks, so check the order that results.
  it('keeps the layer order reset, tokens, base, components, utilities', () => {
    const order: string[] = [];
    for (const match of css.matchAll(/@layer\s+([\w\s,-]+?)\s*[{;]/g)) {
      for (const name of (match[1] ?? '').split(',').map((part) => part.trim())) {
        if (!order.includes(name)) order.push(name);
      }
    }
    expect(order).toEqual(['reset', 'tokens', 'base', 'components', 'utilities']);
  });

  it('declares that order in the first stylesheet the page links, outside the bundle', () => {
    expect(linked[0]).toBe('layers.css');
    expect(readFileSync(path.join(outDir, 'layers.css'), 'utf8')).toContain(
      '@layer reset, tokens, base, components, utilities;',
    );
  });

  it('carries the tokens, the reset and the base layers', () => {
    expect(css).toMatch(/@layer\s+tokens\s*\{/);
    expect(css).toMatch(/@layer\s+reset\s*\{/);
    expect(css).toMatch(/@layer\s+base\s*\{/);
    expect(css).toContain('--surface:');
    expect(css).toContain('prefers-color-scheme:dark');
  });

  it('preloads Inter, the face the first screen draws with, by its built name, and no other font', () => {
    const preloads = [
      ...html.matchAll(/<link rel="preload" href="\/([^"]+)" as="font" type="font\/woff2" crossorigin>/g),
    ].map((match) => match[1] ?? '');
    expect(preloads).toHaveLength(1);
    expect(preloads[0]).toMatch(/^assets\/Inter-Variable-latin[\w.-]*\.woff2$/);
    expect(assets).toContain(preloads[0]?.replace('assets/', ''));
    // Ahead of the stylesheets, so the font starts with the page.
    expect(html.indexOf('rel="preload"')).toBeLessThan(html.search(/<link[^>]+rel="stylesheet"/));
  });

  it('loads both fonts as same origin woff2 files, never as data: URIs', () => {
    const fontUrls = [...css.matchAll(/url\(([^)]+)\)/g)].map((match) => match[1]?.replaceAll(/["']/g, '') ?? '');
    expect(fontUrls.length).toBeGreaterThanOrEqual(2);
    for (const url of fontUrls) expect(url).toMatch(/^\/assets\/[\w.-]+\.woff2$/);
    expect(css).not.toContain('data:font');
    expect(css).not.toContain('data:application/font');
    expect(assets.some((file) => file.startsWith('Inter-Variable-latin') && file.endsWith('.woff2'))).toBe(true);
    expect(assets.some((file) => file.startsWith('JetBrainsMono-Variable-latin') && file.endsWith('.woff2'))).toBe(
      true,
    );
  });
});

describe('the built page', () => {
  // AC-7: the saved theme applies before the stylesheet and the app load, so
  // the other theme never paints first.
  it('runs theme-boot.js before the stylesheet and the app script', () => {
    const boot = html.indexOf('<script src="/theme-boot.js"></script>');
    expect(boot).toBeGreaterThan(0);
    expect(boot).toBeLessThan(html.search(/<link[^>]+rel="stylesheet"/));
    expect(boot).toBeLessThan(html.search(/<script type="module"/));
    expect(assets).not.toContain('theme-boot.js');
    expect(readdirSync(outDir)).toContain('theme-boot.js');
  });

  // style-src 'self' refuses inline styles (style-csp.test.ts): no page ships one, and each page's first stylesheet
  // link carries the id React Aria's usePress checks for, so it never injects its own <style>.
  it.each(['index.html', 'form.html', 'book.html'])(
    'ships %s with no inline style, the pressable id on layers.css',
    (page) => {
      const built = readFileSync(path.join(outDir, page), 'utf8');
      expect(built).not.toMatch(/<style[\s>]|\sstyle=/i);
      expect(built).toContain('<link rel="stylesheet" href="/layers.css" id="react-aria-pressable-style">');
    },
  );
});

describe('the public booking host (22 Oct 2026)', () => {
  // With PUBLIC_HOST_HOME_URL set, the middleware moves any path the public host doesn't serve: every built file a
  // page there loads must be one it serves (public-paths.ts's TOP_LEVEL_FILES and folders).
  it('serves every built file there: each top level file but the pages, and every folder', () => {
    const entries = readdirSync(outDir, { withFileTypes: true }).filter((entry) => !entry.name.startsWith('.'));
    expect(entries.map((entry) => entry.name)).toContain('layers.css');
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.html')) continue;
      const pathname = entry.isFile() ? `/${entry.name}` : `/${entry.name}/file.js`;
      expect(servedOnPublicHost(pathname), pathname).toBe(true);
    }
  });
});

describe('source maps (spec 0010, AC-164)', () => {
  it('leaves no .map file in the output', () => {
    const files = readdirSync(outDir, { recursive: true, encoding: 'utf8' });
    expect(files.length).toBeGreaterThan(0);
    expect(files.filter((file) => file.endsWith('.map'))).toEqual([]);
  });

  it('links no source map from any script or stylesheet', () => {
    const shipped = readdirSync(outDir, { recursive: true, encoding: 'utf8' }).filter((file) =>
      /\.(js|css|html)$/.test(file),
    );
    for (const file of shipped) expect(readFileSync(path.join(outDir, file), 'utf8')).not.toMatch(/sourceMappingURL/);
  });
});

describe('the first load', () => {
  it('loads the Sentry SDK in its own chunk, never up front (spec 0010, AC-169)', () => {
    const { chunks } = firstLoad(manifest);
    const sentry = Object.entries(manifest).find(([key]) => key.endsWith('src/monitoring/sentry.ts'));
    expect(sentry?.[1].isDynamicEntry).toBe(true);
    for (const key of chunks) {
      expect(key).not.toMatch(/@sentry|src\/monitoring\/sentry\.ts/);
      expect(readFileSync(path.join(outDir, manifest[key]?.file ?? ''), 'utf8')).not.toContain('sentry.javascript');
    }
  });

  const HEAVY_ENTRY = /packages\/ui\/src\/(grid|editor|charts|schema-map)\.ts$/;

  it('starts from index.html and follows only static imports', () => {
    const { chunks, js } = firstLoad(manifest);
    expect(chunks[0]).toBe('index.html');
    expect(js.length).toBeGreaterThan(0);
    for (const key of chunks) expect(manifest[key]?.isDynamicEntry ?? false).toBe(false);
  });

  // Rolldown merges shared chunks into the entries that need them, unless any module in the build uses top level
  // await: then every route's file becomes its own chunk, and the first load went from 30 files to 65, 42 kB
  // more gzipped (21 October 2026). Keep top level await out of every entry (src/public/main.ts runs a function).
  it('stays merged into a few dozen files, as it is with no top level await in the build', () => {
    expect(firstLoad(manifest).js.length).toBeLessThanOrEqual(40);
  });

  it('never loads the grid, editor, charts or schema map chunk up front', () => {
    const { chunks } = firstLoad(manifest);
    const heavy = chunks.filter((key) => HEAVY_ENTRY.test(manifest[key]?.src ?? key));
    expect(heavy).toEqual([]);
  });

  // Bulk changes and the Trash (spec 0022) load with the screens that use them. Rolldown merges modules into
  // chunks, so this looks for their words: the bar's and the job toasts' (bulk.ts), the edit dialog's and the
  // Trash's. Each must ship somewhere, so a reworded string can't pass this unseen.
  it('never loads the bulk bar, the edit dialog, the job toasts or the Trash up front', () => {
    const markers = [
      'You can leave out at most 1,000 records from all matching',
      'Choose a field to change.',
      'Nothing left to change.',
      'Deleted records stay here for 30 days',
    ];
    const read = (file: string) => readFileSync(path.join(outDir, file), 'utf8');
    const upFront = firstLoad(manifest).js.map(read);
    const everything = assets.filter((file) => file.endsWith('.js')).map((file) => read(path.join('assets', file)));
    for (const marker of markers) {
      expect(everything.some((text) => text.includes(marker))).toBe(true);
      expect(upFront.filter((text) => text.includes(marker))).toEqual([]);
    }
  });
});
