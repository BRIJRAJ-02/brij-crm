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

  it('never loads the grid, editor, charts or schema map chunk up front', () => {
    const { chunks } = firstLoad(manifest);
    const heavy = chunks.filter((key) => HEAVY_ENTRY.test(manifest[key]?.src ?? key));
    expect(heavy).toEqual([]);
  });
});
