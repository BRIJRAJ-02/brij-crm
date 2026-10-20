// AC-7: theme-boot.js applies a saved Light or Dark choice before first paint,
// using the same key as the controller, and follows the OS for anything else.
// AC-11: it loads as a plain, blocking, same origin script, first in <head>.
// F33: the theme-color metas match the surface token, so a phone's bar is the page.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { THEME_STORAGE_KEY, THEME_SURFACE } from '@crm/ui/theme';
import { describe, expect, it } from 'vitest';

const ROOT = import.meta.dirname;
const script = readFileSync(path.join(ROOT, 'public/theme-boot.js'), 'utf8');
const indexHtml = readFileSync(path.join(ROOT, 'index.html'), 'utf8');

/** Runs the boot script against a fake page, returning the data-theme it set, the keys it read and the bar colours. */
function boot(stored: Record<string, string>, { blocked = false } = {}) {
  const attributes = new Map<string, string>();
  const readKeys: string[] = [];
  const localStorage = {
    getItem: (key: string) => {
      if (blocked) throw new Error('SecurityError');
      readKeys.push(key);
      return stored[key] ?? null;
    },
  };
  const documentElement = { setAttribute: (name: string, value: string) => attributes.set(name, value) };
  const bar = [THEME_SURFACE.light, THEME_SURFACE.dark].map(
    (content) => new Map<string, string>([['content', content]]),
  );
  const metas = bar.map((meta) => ({ setAttribute: (name: string, value: string) => meta.set(name, value) }));
  const querySelectorAll = (selector: string) => (selector === 'meta[name="theme-color"]' ? metas : []);
  runInNewContext(script, { window: { localStorage }, document: { documentElement, querySelectorAll } });
  return { theme: attributes.get('data-theme'), readKeys, bar: bar.map((meta) => meta.get('content')) };
}

describe('theme-boot.js', () => {
  it.each(['light', 'dark'])('applies a saved %s choice', (choice) => {
    expect(boot({ [THEME_STORAGE_KEY]: choice }).theme).toBe(choice);
  });

  it.each(['light', 'dark'] as const)('colours the phone browser bar with the %s surface', (choice) => {
    expect(boot({ [THEME_STORAGE_KEY]: choice }).bar).toEqual([THEME_SURFACE[choice], THEME_SURFACE[choice]]);
  });

  it("leaves the bar to the metas' media under System", () => {
    expect(boot({}).bar).toEqual([THEME_SURFACE.light, THEME_SURFACE.dark]);
  });

  it('reads the same key the theme controller writes', () => {
    expect(boot({}).readKeys).toEqual([THEME_STORAGE_KEY]);
  });

  it.each([
    ['nothing saved', {}],
    ['an unknown value', { [THEME_STORAGE_KEY]: 'purple' }],
  ])('leaves the OS in charge with %s', (_name, stored) => {
    expect(boot(stored).theme).toBeUndefined();
    expect(boot(stored).bar).toEqual([THEME_SURFACE.light, THEME_SURFACE.dark]);
  });

  it('does nothing, and never throws, when storage is blocked', () => {
    expect(() => boot({}, { blocked: true })).not.toThrow();
    expect(boot({}, { blocked: true }).theme).toBeUndefined();
  });
});

describe('index.html', () => {
  it('loads theme-boot.js as the first script in <head>, plain and blocking', () => {
    const head = indexHtml.slice(0, indexHtml.indexOf('</head>'));
    const scripts = [...head.matchAll(/<script\b[^>]*>/g)].map((match) => match[0]);
    expect(scripts[0]).toBe('<script src="/theme-boot.js">');
  });

  it('colours the phone browser bar with the surface token, light and dark', () => {
    const tokens = JSON.parse(readFileSync(path.join(ROOT, '../../packages/tokens/tokens.json'), 'utf8')) as {
      color: { tokens: { name: string; value: Record<string, string> }[] };
    };
    const surface = tokens.color.tokens.find((token) => token.name === 'surface')?.value;
    const metas = [...indexHtml.matchAll(/<meta name="theme-color" content="([^"]+)" media="([^"]+)" \/>/g)].map(
      (match) => [match[2], match[1]],
    );
    expect(metas).toEqual([
      ['(prefers-color-scheme: light)', surface?.light],
      ['(prefers-color-scheme: dark)', surface?.dark],
    ]);
  });
});
