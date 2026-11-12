// AC-7: theme-boot.js applies a saved Light or Dark choice before first paint,
// using the same key as the controller, and follows the OS for anything else.
// AC-11: it loads as a plain, blocking, same origin script, first in <head>.
// F33: the theme-color metas match the surface token, so a phone's bar is the page.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { PUBLIC_APP_PATHS, THEME_STORAGE_KEY, THEME_SURFACE } from '@crm/ui/theme';
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

/** Runs the boot script as a page with `scale` on its script tag at `pathname`, returning the attributes it set. */
function bootScale(scale: string | undefined, pathname: string): Map<string, string> {
  const attributes = new Map<string, string>();
  const currentScript = { getAttribute: (name: string) => (name === 'data-scale' ? (scale ?? null) : null) };
  const documentElement = { setAttribute: (name: string, value: string) => attributes.set(name, value) };
  runInNewContext(script, {
    window: { localStorage: { getItem: () => null }, location: { pathname } },
    document: { currentScript, documentElement, querySelectorAll: () => [] },
  });
  return attributes;
}

describe('theme-boot.js picks the size set (spec 0071, AC-5)', () => {
  it.each(['/w/acme/home', '/sign-in', '/'])('draws the app at its density on %s', (pathname) => {
    expect(bootScale('app', pathname).get('data-scale')).toBe('app');
  });

  it.each(['/embed/tfp_abcdefghijklmnopqrstuv/start', '/email-preferences', '/status', '/public/insights'])(
    'keeps the public screen %s at full size',
    (pathname) => {
      expect(bootScale('app', pathname).has('data-scale')).toBe(false);
    },
  );

  it('leaves a page whose script tag asks for nothing at full size (the public pages)', () => {
    expect(bootScale(undefined, '/w/acme/home').has('data-scale')).toBe(false);
  });

  it("holds the same public path pattern as the router's (PUBLIC_APP_PATHS)", () => {
    expect(script).toContain(`/${PUBLIC_APP_PATHS.source}/.test(window.location.pathname)`);
  });
});

describe('index.html', () => {
  it('loads theme-boot.js as the first script in <head>, plain and blocking, asking for the app scale', () => {
    const head = indexHtml.slice(0, indexHtml.indexOf('</head>'));
    const scripts = [...head.matchAll(/<script\b[^>]*>/g)].map((match) => match[0]);
    expect(scripts[0]).toBe('<script src="/theme-boot.js" data-scale="app">');
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
