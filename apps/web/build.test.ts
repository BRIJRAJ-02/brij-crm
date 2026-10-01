// Builds the app the way Vercel does and checks the CSS that ships: the cascade
// layer order survives Vite's @import inlining (AC-5, AC-12), and the fonts are
// same origin files under /assets/, never data: URIs the CSP would refuse (AC-11).
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ROOT = import.meta.dirname;
const outDir = mkdtempSync(path.join(tmpdir(), 'crm-web-build-'));
let assets: string[] = [];
let css = '';
let html = '';

beforeAll(async () => {
  await build({
    root: ROOT,
    configFile: path.join(ROOT, 'vite.config.ts'),
    logLevel: 'silent',
    build: { outDir, emptyOutDir: true, sourcemap: false },
  });
  assets = readdirSync(path.join(outDir, 'assets'));
  css = assets
    .filter((file) => file.endsWith('.css'))
    .map((file) => readFileSync(path.join(outDir, 'assets', file), 'utf8'))
    .join('\n');
  html = readFileSync(path.join(outDir, 'index.html'), 'utf8');
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
