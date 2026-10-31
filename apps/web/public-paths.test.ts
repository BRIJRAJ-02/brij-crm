// The handle addresses' routing (22 Oct 2026): vercel.json says exactly what public-paths.ts builds, every top level
// path the app serves is a reserved word, and each kind of path gets the bundle and the policy it should.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { RESERVED_HANDLES } from '@crm/contracts/handles';
import { LAYER_ORDER_FILE } from '@crm/ui/vite';
import { describe, expect, it } from 'vitest';
import { directiveSources, policyForPath, sourcePattern } from './csp.ts';
import {
  APP_HEADER_SOURCE,
  HANDLE_HEADER_SOURCE,
  HANDLE_PATH,
  handleHostRedirect,
  hasSessionHint,
  PAGE_SOURCE,
  PROFILE_SOURCE,
  publicHostRedirect,
  servedOnPublicHost,
  STAY_PARAM,
  TOP_LEVEL_FILES,
} from './public-paths.ts';
import { SESSION_HINT_COOKIE, SESSION_HINT_PRESENT } from './src/features/auth/parent-hint.ts';

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
    // Both handle addresses are served by the shell function (spec 0055), which answers the built shell and a
    // meta block written from the person, or from the booking page the slug names.
    ['/ada', '/api/handle'],
    ['/ada-lovelace/30min', '/api/handle'],
    ['/ada/30min-2', '/api/handle'],
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

  it('gives the shell function’s answer the headers the static shell got, value for value (AC-5505)', () => {
    // Nothing about the policy is written in the function: vercel.json's block matches the path, whoever answers
    // it, so the two can never drift. This fails if a later change narrows that block to static files.
    expect(policyForPath('/ada')).toBe(policyForPath('/ada/30min'));
    expect(policyForPath('/ada')).toBeDefined();
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

describe('the public booking host', () => {
  it.each([
    '/ada',
    '/ada/30min',
    '/ada/30min/',
    '/b/AbCdEfGhIjKlMnOp',
    '/b/AbCdEfGhIjKlMnOp/manage',
    '/f/contact',
    '/embed/v1.js',
    '/embed.js',
    '/assets/book-abc123.js',
    '/brand/timefix-mark.svg',
    '/theme-boot.js',
    '/favicon.ico',
    '/layers.css',
    '/api/public/handles/ada',
    // The crawl files, answered by the api (spec 0061, AC-6123).
    '/robots.txt',
    '/sitemap-handles.xml',
  ])('serves %s', (pathname) => {
    expect(servedOnPublicHost(pathname)).toBe(true);
  });

  it.each([
    '/',
    '/sign-in',
    '/settings/profile',
    '/w/acme/objects/people',
    '/index.html',
    '/book.html',
    '/x.js',
    '/robots.txt.bak',
    '/sitemap.xml',
    '/api',
    '/api/rpc/system/status',
    '/api/publication',
    '/ada/30min/extra',
    '/ab',
  ])('sends %s away', (pathname) => {
    expect(servedOnPublicHost(pathname)).toBe(false);
  });

  it('lists every top level file the build serves: public/’s, and the layer order stylesheet', () => {
    const files = readdirSync(path.join(import.meta.dirname, 'public'), { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name);
    expect([...TOP_LEVEL_FILES].sort()).toEqual([...files, LAYER_ORDER_FILE].sort());
    const folders = readdirSync(path.join(import.meta.dirname, 'public'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    for (const folder of folders) expect(servedOnPublicHost(`/${folder}/anything.svg`), folder).toBe(true);
  });

  it('keeps every path vercel.json sends to the booking or form bundle', () => {
    for (const pathname of ['/ada', '/ada-lovelace/30min', '/b/AbCdEfGhIjKlMnOp', '/f/contact']) {
      expect(['/book.html', '/form.html', '/api/handle']).toContain(destinationOf(pathname));
      expect(servedOnPublicHost(pathname), pathname).toBe(true);
    }
  });

  const env = {
    PUBLIC_HOST_HOME_URL: 'https://www.timefix.com',
    BOOKING_PUBLIC_ORIGIN: 'https://timefix.com',
    APP_URL: 'https://app.timefix.com',
  };

  it('moves anything else on that host to the marketing site, and nothing on another host', () => {
    expect(publicHostRedirect(new URL('https://timefix.com/'), env)).toEqual({
      location: 'https://www.timefix.com/',
      onCookie: true,
    });
    expect(publicHostRedirect(new URL('https://timefix.com/sign-in?next=/w'), env)).toEqual({
      location: 'https://www.timefix.com/',
      onCookie: false,
    });
    expect(publicHostRedirect(new URL('https://timefix.com/ada/30min'), env)).toBeUndefined();
    expect(publicHostRedirect(new URL('https://app.timefix.com/'), env)).toBeUndefined();
  });

  // The owner, 25 Oct 2026: "if I am already logged in and I go to timefix.com, it should just detect and take me
  // to the dashboard". The session cookie is host only, so the apex can't see it; the parent domain hint can.
  describe('the apex home and the session hint', () => {
    const hint = `${SESSION_HINT_COOKIE}=${SESSION_HINT_PRESENT}`;
    const root = new URL('https://timefix.com/');

    it('sends a browser holding the hint to the app, and says a cookie decided it', () => {
      expect(publicHostRedirect(root, env, hint)).toEqual({ location: 'https://app.timefix.com/', onCookie: true });
      expect(publicHostRedirect(root, env, `other=1; ${hint}; third=2`)).toEqual({
        location: 'https://app.timefix.com/',
        onCookie: true,
      });
      expect(publicHostRedirect(new URL('https://timefix.com/?utm_source=x'), env, hint)).toEqual({
        location: 'https://app.timefix.com/',
        onCookie: true,
      });
    });

    it('sends a browser without it to the marketing site, as before', () => {
      for (const cookie of [undefined, '', 'theme=dark', `${SESSION_HINT_COOKIE}=`, `${SESSION_HINT_COOKIE}=0`]) {
        expect(publicHostRedirect(root, env, cookie), String(cookie)).toEqual({
          location: 'https://www.timefix.com/',
          onCookie: true,
        });
      }
      expect(hasSessionHint('tf_signed_in_other=1')).toBe(false);
      expect(hasSessionHint('xtf_signed_in=1')).toBe(false);
      expect(hasSessionHint(hint)).toBe(true);
    });

    it('keeps the marketing site with ?stay, the way back for someone signed in, reading no cookie', () => {
      expect(publicHostRedirect(new URL(`https://timefix.com/?${STAY_PARAM}=1`), env, hint)).toEqual({
        location: 'https://www.timefix.com/',
        onCookie: false,
      });
      expect(publicHostRedirect(new URL(`https://timefix.com/?${STAY_PARAM}`), env, hint)).toEqual({
        location: 'https://www.timefix.com/',
        onCookie: false,
      });
    });

    it('leaves every public path where it is, hint or no hint', () => {
      const paths = ['/ada', '/ada/30min', '/b/AbCdEfGhIjKlMnOp', '/f/contact', '/embed/v1.js', '/embed.js'];
      for (const pathname of paths) {
        const at = new URL(`https://timefix.com${pathname}`);
        expect(publicHostRedirect(at, env, hint), pathname).toBeUndefined();
        expect(publicHostRedirect(at, env), pathname).toBeUndefined();
      }
    });

    it('never reads the hint on any path but the home, so a cached move stays cacheable', () => {
      for (const pathname of ['/sign-in', '/settings/profile', '/w/acme', '/book.html']) {
        expect(publicHostRedirect(new URL(`https://timefix.com${pathname}`), env, hint), pathname).toEqual({
          location: 'https://www.timefix.com/',
          onCookie: false,
        });
      }
    });

    it('changes nothing on the app’s own host or a preview, hint or no hint', () => {
      expect(publicHostRedirect(new URL('https://app.timefix.com/'), env, hint)).toBeUndefined();
      const oneHost = { ...env, BOOKING_PUBLIC_ORIGIN: 'https://app.timefix.com' };
      expect(publicHostRedirect(new URL('https://app.timefix.com/'), oneHost, hint)).toBeUndefined();
      expect(publicHostRedirect(root, { ...env, PUBLIC_HOST_HOME_URL: '' }, hint)).toBeUndefined();
      expect(publicHostRedirect(root, { ...env, APP_URL: undefined }, hint)).toBeUndefined();
    });
  });

  it('does nothing unless both origins are set, https, and apart from the app’s', () => {
    const root = new URL('https://timefix.com/');
    expect(publicHostRedirect(root, { ...env, PUBLIC_HOST_HOME_URL: undefined })).toBeUndefined();
    expect(publicHostRedirect(root, { ...env, PUBLIC_HOST_HOME_URL: '' })).toBeUndefined();
    expect(publicHostRedirect(root, { ...env, PUBLIC_HOST_HOME_URL: 'http://www.timefix.com' })).toBeUndefined();
    expect(publicHostRedirect(root, { ...env, PUBLIC_HOST_HOME_URL: 'not a url' })).toBeUndefined();
    expect(publicHostRedirect(root, { ...env, BOOKING_PUBLIC_ORIGIN: undefined })).toBeUndefined();
    expect(publicHostRedirect(root, { ...env, APP_URL: 'https://timefix.com' })).toBeUndefined();
    expect(publicHostRedirect(root, { ...env, APP_URL: undefined })).toBeUndefined();
    // With no APP_URL the app's own host is never moved, even were it named the public origin.
    const appRoot = new URL('https://app.timefix.com/settings');
    expect(
      publicHostRedirect(appRoot, { ...env, APP_URL: undefined, BOOKING_PUBLIC_ORIGIN: 'https://app.timefix.com' }),
    ).toBeUndefined();
    expect(publicHostRedirect(root, { ...env, PUBLIC_HOST_HOME_URL: 'https://timefix.com/home' })).toBeUndefined();
  });

  it('moves a handle address off the app’s host to the booking origin, and nothing else there', () => {
    expect(handleHostRedirect(new URL('https://app.timefix.com/ada'), env)).toBe('https://timefix.com/ada');
    expect(handleHostRedirect(new URL('https://app.timefix.com/ada/30min'), env)).toBe('https://timefix.com/ada/30min');
    expect(handleHostRedirect(new URL('https://app.timefix.com/ada/'), env)).toBe('https://timefix.com/ada/');
    expect(handleHostRedirect(new URL('https://app.timefix.com/ada?month=2026-11'), env)).toBe(
      'https://timefix.com/ada?month=2026-11',
    );
    for (const pathname of [
      '/',
      '/sign-in',
      '/settings/profile',
      '/w/acme',
      '/api/public/handles/ada',
      '/api/rpc/system/status',
      '/b/AbCdEfGhIjKlMnOp',
      '/f/contact',
      '/embed/v1.js',
      '/embed.js',
      '/favicon.ico',
      '/brand/timefix-mark.svg',
      '/assets/app.js',
    ]) {
      expect(handleHostRedirect(new URL(`https://app.timefix.com${pathname}`), env), pathname).toBeUndefined();
    }
  });

  it('moves a handle address on no other host, and on none at all without both origins', () => {
    expect(handleHostRedirect(new URL('https://timefix.com/ada'), env)).toBeUndefined();
    expect(handleHostRedirect(new URL('https://brij-crm.vercel.app/ada'), env)).toBeUndefined();
    const app = new URL('https://app.timefix.com/ada');
    expect(handleHostRedirect(app, { ...env, BOOKING_PUBLIC_ORIGIN: undefined })).toBeUndefined();
    expect(handleHostRedirect(app, { ...env, BOOKING_PUBLIC_ORIGIN: '' })).toBeUndefined();
    expect(handleHostRedirect(app, { ...env, BOOKING_PUBLIC_ORIGIN: 'http://timefix.com' })).toBeUndefined();
    expect(handleHostRedirect(app, { ...env, APP_URL: undefined })).toBeUndefined();
    // One host serving both, as a preview and local development do: nothing moves.
    expect(handleHostRedirect(app, { ...env, BOOKING_PUBLIC_ORIGIN: 'https://app.timefix.com' })).toBeUndefined();
  });
});
