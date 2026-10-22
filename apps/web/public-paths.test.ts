// The handle addresses' routing (22 Oct 2026): vercel.json says exactly what public-paths.ts builds, every top level
// path the app serves is a reserved word, and each kind of path gets the bundle and the policy it should.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { RESERVED_HANDLES } from '@crm/contracts/handles';
import { describe, expect, it } from 'vitest';
import { directiveSources, policyForPath, sourcePattern } from './csp.ts';
import { APP_HEADER_SOURCE, HANDLE_HEADER_SOURCE, HANDLE_PATH, PAGE_SOURCE, PROFILE_SOURCE } from './public-paths.ts';

const config = JSON.parse(readFileSync(path.join(import.meta.dirname, 'vercel.json'), 'utf8')) as {
  readonly rewrites: readonly { readonly source: string; readonly destination: string }[];
  readonly headers: readonly { readonly source: string }[];
};

/** Where vercel.json sends a path: the first rewrite whose source matches it, as Vercel takes them in order. */
const destinationOf = (pathname: string) =>
  config.rewrites.find((rule) => sourcePattern(rule.source).test(pathname))?.destination;

describe('vercel.json (handle addresses)', () => {
  it('rewrites /<handle> and /<handle>/<slug> to the booking bundle, before the app’s fallback', () => {
    const sources = config.rewrites.map((rule) => rule.source);
    expect(sources).toContain(PROFILE_SOURCE);
    expect(sources).toContain(PAGE_SOURCE);
    expect(sources.indexOf(PAGE_SOURCE)).toBeLessThan(sources.indexOf('/((?!api/|api$|f/|b/|embed/).*)'));
    expect(config.headers.map((rule) => rule.source)).toEqual(
      expect.arrayContaining([APP_HEADER_SOURCE, HANDLE_HEADER_SOURCE]),
    );
  });

  it.each([
    ['/ada', '/book.html'],
    ['/ada-lovelace/30min', '/book.html'],
    ['/ada/30min-2', '/book.html'],
    ['/b/AbCdEfGhIjKlMnOp', '/book.html'],
    ['/f/contact', '/form.html'],
    ['/', '/index.html'],
    ['/sign-in', '/index.html'],
    ['/welcome', '/index.html'],
    ['/invite/abc', '/index.html'],
    ['/w/acme/objects/people', '/index.html'],
    ['/settings/profile', '/index.html'],
    ['/ab', '/index.html'],
    ['/ada/30min/extra', '/index.html'],
  ])('sends %s to %s', (pathname, destination) => {
    expect(destinationOf(pathname)).toBe(destination);
  });

  it('lets any site frame a handle address, as /b/<key>, and keeps the app’s own policy everywhere else', () => {
    expect(directiveSources(policyForPath('/ada') ?? '', 'frame-ancestors')).toEqual(['*']);
    expect(directiveSources(policyForPath('/ada/30min') ?? '', 'frame-ancestors')).toEqual(['*']);
    expect(directiveSources(policyForPath('/sign-in') ?? '', 'frame-ancestors')).toEqual(["'self'"]);
    expect(directiveSources(policyForPath('/w/acme') ?? '', 'frame-ancestors')).toEqual(["'self'"]);
    expect(directiveSources(policyForPath('/welcome') ?? '', 'frame-ancestors')).toEqual(["'self'"]);
    expect(policyForPath('/api/public/handles/ada')).toBeUndefined();
  });

  it('matches the dev server’s rewrite to the deployed one', () => {
    expect(HANDLE_PATH.test('/ada')).toBe(true);
    expect(HANDLE_PATH.test('/ada/30min')).toBe(true);
    expect(HANDLE_PATH.test('/sign-in')).toBe(false);
    expect(HANDLE_PATH.test('/src/main.tsx')).toBe(false);
    expect(HANDLE_PATH.test('/node_modules/.vite/deps/react.js')).toBe(false);
  });
});

describe('the reserved words', () => {
  it('hold every top level route the app has', () => {
    const routes = readdirSync(path.join(import.meta.dirname, 'src', 'routes'))
      .filter((file) => file.endsWith('.tsx') && !file.startsWith('__'))
      .map((file) => file.split('.')[0] ?? '')
      .filter((word) => word !== 'index' && word !== '');
    for (const word of new Set(routes)) expect(RESERVED_HANDLES, word).toContain(word);
  });

  it('hold every top level file and folder the build serves', () => {
    const served = readdirSync(path.join(import.meta.dirname, 'public')).map((name) => name.split('.')[0] ?? '');
    for (const word of [...served, 'api', 'assets', 'embed', 'b', 'f']) expect(RESERVED_HANDLES, word).toContain(word);
  });
});
