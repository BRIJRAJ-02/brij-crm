// The handle address's shell (spec 0055): what each kind of read answers, and that a read which misses in any way
// hands back the built shell rather than an error.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  BOOT_ID,
  cacheControlFor,
  cardUrl,
  lookOf,
  partsOf,
  shellFor,
  withBoot,
  withLook,
  LOOK_LINK_ID,
  type ShellDeps,
  type ShellProfile,
} from './handle-shell.ts';
import { bootOf, BOOT_ID as PAGE_BOOT_ID } from './src/public/booking/boot.ts';
import { LOOK_LINK_ID as PAGE_LOOK_LINK_ID } from './src/public/stylesheet.ts';

const shell = readFileSync(path.join(import.meta.dirname, 'book.html'), 'utf8');

const profile: ShellProfile = {
  handle: 'anish',
  name: 'Anish Rao',
  bio: 'Designer in Bangalore.',
  theme: { ground: 'ink', hue: 'purple', mode: 'dark', shape: 'pill', fill: 'solid', font: 'mono' },
  version: 'a1b2c3',
};

const deps = (over: Partial<ShellDeps> = {}): ShellDeps => ({
  shell,
  origin: 'https://timefix.com',
  cardOrigin: 'https://timefix.com',
  readProfile: () => Promise.resolve(profile),
  ...over,
});

describe('partsOf', () => {
  it('reads a handle, with or without a trailing slash', () => {
    expect(partsOf('/anish')).toEqual({ handle: 'anish' });
    expect(partsOf('/anish/')).toEqual({ handle: 'anish' });
  });

  it('reads a booking page’s address', () => {
    expect(partsOf('/anish/intro')).toEqual({ handle: 'anish', slug: 'intro' });
  });

  it('is nothing for a path that names no handle', () => {
    expect(partsOf('/settings')).toBeUndefined();
    expect(partsOf('/api/public/handles/anish')).toBeUndefined();
    expect(partsOf('/b/abc123')).toBeUndefined();
  });
});

describe('lookOf', () => {
  it('takes all six names', () => {
    expect(lookOf(profile.theme)).toEqual(profile.theme);
  });

  it('takes none of them when one is missing, malformed or not a word', () => {
    expect(lookOf({ ground: 'ink' })).toBeUndefined();
    expect(lookOf({ ...(profile.theme as object), font: '"><script>' })).toBeUndefined();
    expect(lookOf({ ...(profile.theme as object), hue: 42 })).toBeUndefined();
    expect(lookOf(undefined)).toBeUndefined();
    expect(lookOf('dark')).toBeUndefined();
  });
});

describe('cardUrl', () => {
  it('versions the address, so a new picture is a new address', () => {
    expect(cardUrl('https://timefix.com', 'anish', 'a1b2c3')).toBe(
      'https://timefix.com/api/public/handles/anish/card.png?v=a1b2c3',
    );
  });

  it('leaves the version off when there is none', () => {
    expect(cardUrl('https://timefix.com', 'anish', undefined)).toBe(
      'https://timefix.com/api/public/handles/anish/card.png',
    );
  });
});

const page = { title: 'Intro call', description: 'Fifteen minutes, by video.', hostName: 'Anish Rao' };

describe('shellFor, a booking page’s own address', () => {
  const pageDeps = (over: Partial<ShellDeps> = {}) => deps({ readPage: () => Promise.resolve(page), ...over });

  it('names the page and the host it belongs to, not the product', async () => {
    const answer = await shellFor('/anish/intro', pageDeps());
    expect(answer.status).toBe(200);
    expect(answer.outcome).toBe('page');
    expect(answer.body).toContain('<title>Intro call · Anish Rao</title>');
    expect(answer.body).toContain('<meta name="description" content="Fifteen minutes, by video." />');
    expect(answer.body).toContain('<meta property="og:type" content="website" />');
    expect(answer.body).toContain('<link rel="canonical" href="https://timefix.com/anish/intro" />');
  });

  it('falls back to the product when the page names no host', async () => {
    const answer = await shellFor(
      '/anish/intro',
      pageDeps({ readPage: () => Promise.resolve({ title: 'Intro call' }) }),
    );
    expect(answer.body).toContain('<title>Intro call · Timefix</title>');
  });

  it('is never indexed on its own: a person’s page is the way in', async () => {
    const answer = await shellFor('/anish/intro', pageDeps());
    expect(answer.body).toContain('<meta name="robots" content="noindex, follow" />');
  });

  it('reads the handle and the slug apart, never a path', async () => {
    const readPage = vi.fn(() => Promise.resolve(page));
    await shellFor('/anish/intro', pageDeps({ readPage }));
    expect(readPage).toHaveBeenCalledWith('anish', 'intro', expect.any(AbortSignal));
  });

  it('answers a 404 and the brand’s words for a page nobody holds', async () => {
    const answer = await shellFor('/anish/gone', pageDeps({ readPage: () => Promise.resolve(undefined) }));
    expect(answer.status).toBe(404);
    expect(answer.body).toContain('<title>Timefix</title>');
  });

  it('hands back the built shell when the read fails', async () => {
    const answer = await shellFor('/anish/intro', pageDeps({ readPage: () => Promise.reject(new Error('down')) }));
    expect(answer.body).toBe(shell);
    expect(answer.status).toBe(200);
  });

  it('changes nothing below the head, as the profile’s does not', async () => {
    const answer = await shellFor('/anish/intro', pageDeps());
    const bodyOf = (html: string) => html.slice(html.indexOf('</head>'));
    expect(bodyOf(answer.body)).toBe(bodyOf(shell));
  });
});

describe('shellFor', () => {
  it('answers the person’s page, with their look and their card', async () => {
    const answer = await shellFor('/anish', deps());
    expect(answer.status).toBe(200);
    expect(answer.outcome).toBe('profile');
    expect(answer.body).toContain('<title>Anish Rao · Timefix</title>');
    expect(answer.body).toContain('<link rel="canonical" href="https://timefix.com/anish" />');
    expect(answer.body).toContain('og:image" content="https://timefix.com/api/public/handles/anish/card.png?v=a1b2c3"');
    expect(answer.body).toContain('data-page-ground="ink"');
  });

  it('claims no picture while no card route answers, rather than naming one that 404s', async () => {
    const answer = await shellFor('/anish', { ...deps(), cardOrigin: undefined });
    expect(answer.body).not.toContain('og:image');
    expect(answer.body).toContain('<meta name="twitter:card" content="summary" />');
    expect(answer.body).toContain('<title>Anish Rao · Timefix</title>');
  });

  it('reads the handle alone, never a path', async () => {
    const readProfile = vi.fn(() => Promise.resolve(profile));
    await shellFor('/anish', deps({ readProfile }));
    expect(readProfile).toHaveBeenCalledWith('anish', expect.any(AbortSignal));
  });

  it('follows a handle that moved to the one its owner holds now', async () => {
    const answer = await shellFor('/anish-old', deps({ readProfile: () => Promise.resolve(profile) }));
    expect(answer.body).toContain('<link rel="canonical" href="https://timefix.com/anish" />');
  });

  it('says noindex for a page whose owner turned indexing off', async () => {
    const answer = await shellFor(
      '/anish',
      deps({ readProfile: () => Promise.resolve({ ...profile, indexable: false }) }),
    );
    expect(answer.body).toContain('<meta name="robots" content="noindex, follow" />');
  });

  it('shows the page unless its owner said not to', async () => {
    const answer = await shellFor(
      '/anish',
      deps({ readProfile: () => Promise.resolve({ ...profile, indexable: undefined }) }),
    );
    expect(answer.body).toContain('<meta name="robots" content="index, follow" />');
  });

  it('answers a 404 and the brand’s own words for an address nobody holds', async () => {
    const answer = await shellFor('/nobody', deps({ readProfile: () => Promise.resolve(undefined) }));
    expect(answer.status).toBe(404);
    expect(answer.outcome).toBe('unknown');
    expect(answer.body).toContain('<title>Timefix</title>');
    expect(answer.body).toContain('<meta name="robots" content="noindex, follow" />');
    expect(answer.body).not.toContain('og:image');
  });

  it('hands back the built shell, with a 200, when the read fails', async () => {
    const onMiss = vi.fn();
    const answer = await shellFor(
      '/anish',
      deps({ readProfile: () => Promise.reject(new Error('api is down')), onMiss }),
    );
    expect(answer.status).toBe(200);
    expect(answer.outcome).toBe('missed');
    expect(answer.body).toBe(shell);
    expect(onMiss).toHaveBeenCalledWith('anish', 'Error');
  });

  it('hands back the built shell when the read times out', async () => {
    const answer = await shellFor(
      '/anish',
      deps({
        readProfile: (_handle, signal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => {
              reject(signal.reason as Error);
            });
          }),
      }),
    );
    expect(answer.body).toBe(shell);
    expect(answer.status).toBe(200);
  }, 3_000);

  it('leaves a booking page’s address alone where no page read is given', async () => {
    const readProfile = vi.fn(() => Promise.resolve(profile));
    const answer = await shellFor('/anish/intro', deps({ readProfile }));
    expect(answer.body).toBe(shell);
    expect(readProfile).not.toHaveBeenCalled();
  });

  it('leaves a path that names no handle alone', async () => {
    expect((await shellFor('/settings', deps())).body).toBe(shell);
  });
});

/** The boot block's JSON in a shell, as the page reads it. */
const bootIn = (html: string) =>
  new RegExp(`<script type="application/json" id="${BOOT_ID}">(.*?)</script>`).exec(html)?.[1];

describe('the boot block (29 Oct 2026)', () => {
  it('is the id the page reads', () => {
    expect(PAGE_BOOT_ID).toBe(BOOT_ID);
  });

  it('hands a profile to the page, in the head, and preloads its picture', async () => {
    const image = '/api/public/profiles/anish/picture?v=a1b2c3';
    const { body } = await shellFor(
      '/anish',
      deps({ readProfile: () => Promise.resolve({ ...profile, image }), now: () => 1_000 }),
    );
    const head = body.slice(0, body.indexOf('</head>'));
    expect(head).toContain(`<link rel="preload" as="image" href="${image}">`);
    expect(JSON.parse(bootIn(head) ?? '')).toMatchObject({
      kind: 'profile',
      profile: { handle: 'anish', image },
      readAt: 1_000,
    });
  });

  it('hands a booking page its key and current address, so it never looks the address up', async () => {
    const { body } = await shellFor(
      '/anish/intro',
      deps({ readPage: () => Promise.resolve({ publicKey: 'k123', handle: 'anish-rao', slug: 'intro-call' }) }),
    );
    expect(bootOf(bootIn(body))).toEqual({ kind: 'page', publicKey: 'k123', handle: 'anish-rao', slug: 'intro-call' });
  });

  it('writes none for a page read without a key, nor when the read misses', async () => {
    const keyless = await shellFor('/anish/intro', deps({ readPage: () => Promise.resolve({ title: 'Intro' }) }));
    expect(bootIn(keyless.body)).toBeUndefined();
    const missed = await shellFor('/anish', deps({ readProfile: () => Promise.reject(new Error('down')) }));
    expect(bootIn(missed.body)).toBeUndefined();
  });

  it('cannot be closed early by anything a person wrote', () => {
    const bio = '</script><script>alert(1)</script><!--';
    const html = withBoot(shell, { kind: 'profile', profile: { ...profile, bio }, readAt: 0 });
    const json = bootIn(html) ?? '';
    expect(json).not.toContain('<');
    expect((JSON.parse(json) as { profile: { bio: string } }).profile.bio).toBe(bio);
    expect(html.match(/<\/script>/g)?.length).toBe((shell.match(/<\/script>/g)?.length ?? 0) + 1);
  });

  it('preloads only a picture on our own api, and never one that could leave its attribute', () => {
    const outside = withBoot(shell, {
      kind: 'profile',
      profile: { ...profile, image: 'https://evil.test/x.png' },
      readAt: 0,
    });
    const quoted = withBoot(shell, {
      kind: 'profile',
      profile: { ...profile, image: '/api/public/x"><b>' },
      readAt: 0,
    });
    expect(outside).not.toContain('rel="preload" as="image"');
    expect(quoted).not.toContain('rel="preload" as="image"');
  });
});

describe('the look in the head (spec 0060, AC-20, AC-21)', () => {
  const fonts = {
    sans: '/assets/Inter-Variable-latin-AbC123.woff2',
    display: '/assets/InstrumentSerif-Regular-latin-dEf456.woff2',
    mono: '/assets/JetBrainsMono-Variable-latin-x9.woff2',
  };
  const display = {
    ...profile,
    theme: { ...(profile.theme as object), font: 'display' },
    look: { version: 'abcdef012345' },
  };
  const headOf = (html: string) => html.slice(0, html.indexOf('</head>'));

  it('is the id the page finds again', () => {
    expect(PAGE_LOOK_LINK_ID).toBe(LOOK_LINK_ID);
  });

  it('links the page’s own stylesheet on our api and preloads its pack’s heading face, and no other', async () => {
    const { body } = await shellFor('/anish', deps({ readProfile: () => Promise.resolve(display), fonts }));
    const head = headOf(body);
    expect(head).toContain(
      `<link rel="stylesheet" id="${LOOK_LINK_ID}" href="/api/public/handles/anish/look.css?v=abcdef012345">`,
    );
    expect(head).toContain(`<link rel="preload" href="${fonts.display}" as="font" type="font/woff2" crossorigin>`);
    expect(head).not.toContain(fonts.mono);
    // Nothing it fetches from another origin, and nothing inline.
    const fetched = head.match(/<link[^>]+rel="(?:stylesheet|preload)"[^>]*>/g) ?? [];
    expect(fetched.length).toBeGreaterThan(1);
    expect(fetched.filter((link) => /href="(?:https?:)?\/\//.test(link))).toEqual([]);
    expect(head).not.toMatch(/<style|style="/);
  });

  it('names a file once: Inter, which the build preloads already, is not preloaded again', () => {
    const built = shell.replace('</head>', `<link rel="preload" href="${fonts.sans}" as="font" crossorigin></head>`);
    const html = withLook(built, { ...profile, theme: { font: 'sans' } }, fonts);
    expect(html.split(fonts.sans).length - 1).toBe(1);
  });

  it('writes no stylesheet for a page without one, nor for a malformed version or handle', () => {
    expect(withLook(shell, profile, fonts)).not.toContain('look.css');
    expect(withLook(shell, { ...display, look: { version: '"><b>' } }, fonts)).not.toContain('look.css');
    expect(withLook(shell, { ...display, handle: 'a"b' }, fonts)).not.toContain('look.css');
  });

  it('preloads nothing for a font it has no built file for, nor a file outside the build', () => {
    expect(withLook(shell, display, {})).not.toContain('as="font"');
    expect(withLook(shell, display, { display: 'https://fonts.example/x.woff2' })).not.toContain('as="font"');
  });

  it('adds nothing to a booking page’s shell, a miss or an unknown handle', async () => {
    const missed = await shellFor('/anish', deps({ readProfile: () => Promise.reject(new Error('down')), fonts }));
    expect(missed.body).toBe(shell);
    const page = await shellFor(
      '/anish/intro',
      deps({ readPage: () => Promise.resolve({ publicKey: 'k123', title: 'Intro' }), fonts }),
    );
    expect(page.body).not.toContain('look.css');
  });
});

describe('cacheControlFor', () => {
  it('keeps a missed read for seconds, so a cold api never leaves the plain shell cached for minutes', () => {
    expect(cacheControlFor('missed')).toBe('public, s-maxage=10');
    expect(cacheControlFor('page')).toBe('public, s-maxage=300, stale-while-revalidate=86400');
  });

  it('keeps a link page, or the 404 a private one answers, two minutes at most, so its switch shows promptly', () => {
    // Spec 0058, AC-23: a page made Private must not be served from the edge for long, stale or fresh.
    for (const outcome of ['profile', 'unknown'] as const) {
      const header = cacheControlFor(outcome);
      expect(header).toBe('public, s-maxage=60, stale-while-revalidate=60');
      const seconds = (name: string) => Number(new RegExp(`${name}=(\\d+)`).exec(header)?.[1] ?? 'NaN');
      expect(seconds('s-maxage') + seconds('stale-while-revalidate')).toBeLessThanOrEqual(120);
    }
  });
});

describe('the edge cache tags', () => {
  it('files a link page’s shell under the address asked and the handle its owner holds now', async () => {
    const answer = await shellFor('/anish-old', deps({ readProfile: () => Promise.resolve(profile) }));
    expect(answer.tags).toEqual(['link-page:anish-old', 'link-page:anish']);
    expect((await shellFor('/anish', deps())).tags).toEqual(['link-page:anish']);
  });

  it('files the 404 a private page answers under its handle, so going Live again deletes it', async () => {
    const answer = await shellFor('/anish', deps({ readProfile: () => Promise.resolve(undefined) }));
    expect(answer.tags).toEqual(['link-page:anish']);
  });

  it('files nothing for a miss or a booking page, which the switch doesn’t touch', async () => {
    const missed = await shellFor('/anish', deps({ readProfile: () => Promise.reject(new Error('down')) }));
    expect(missed.tags).toBeUndefined();
    const booking = await shellFor('/anish/intro', deps({ readPage: () => Promise.resolve(page) }));
    expect(booking.outcome).toBe('page');
    expect(booking.tags).toBeUndefined();
  });
});

describe('structured data and crawler text (spec 0061, AC-6121, AC-6122)', () => {
  const rich: ShellProfile = {
    ...profile,
    image: '/api/public/profiles/anish/picture?v=1',
    bio: 'Designer </script><script>alert(1)</script>',
    socials: [
      { network: 'linkedin', href: 'https://www.linkedin.com/in/anish' },
      { network: 'x', href: 'javascript:alert(1)' },
    ],
    items: [
      { kind: 'link', id: 'a', title: 'Portfolio <b>', url: 'https://anish.design' },
      { kind: 'link', id: 'b', title: 'After dark', url: 'https://example.com/x', notice: '18' },
      { kind: 'link', id: 'c', title: 'Mail me', url: 'mailto:a@b.co' },
      { kind: 'heading', id: 'd', title: 'Work' },
    ],
  };

  /** The one structured data block's JSON, or undefined. */
  const ldOf = (html: string) => {
    const found = [...html.matchAll(/<script type="application\/ld\+json">([^<]*)<\/script>/g)];
    expect(found.length).toBeLessThanOrEqual(1);
    const [first] = found;
    return first?.[1] === undefined ? undefined : (JSON.parse(first[1]) as Record<string, unknown>);
  };

  it('carries one ProfilePage for a Person, with every < written escaped', async () => {
    const answer = await shellFor('/anish', deps({ readProfile: () => Promise.resolve(rich) }));
    const ld = ldOf(answer.body);
    expect(ld).toEqual({
      '@context': 'https://schema.org',
      '@type': 'ProfilePage',
      url: 'https://timefix.com/anish',
      mainEntity: {
        '@type': 'Person',
        name: 'Anish Rao',
        description: 'Designer </script><script>alert(1)</script>',
        image: 'https://timefix.com/api/public/profiles/anish/picture?v=1',
        url: 'https://timefix.com/anish',
        sameAs: ['https://www.linkedin.com/in/anish'],
      },
    });
    const head = answer.body.slice(0, answer.body.indexOf('</head>'));
    expect(head).not.toContain('</script><script>alert');
    expect(head).toContain('\\u003c/script>');
  });

  it('carries none on a page set not to index', async () => {
    const answer = await shellFor(
      '/anish',
      deps({ readProfile: () => Promise.resolve({ ...rich, indexable: false }) }),
    );
    expect(ldOf(answer.body)).toBeUndefined();
  });

  it('writes the name, the bio and the live web links into the root, escaped, leaving noticed links out', async () => {
    const answer = await shellFor('/anish', deps({ readProfile: () => Promise.resolve(rich) }));
    const root = /<div id="root"[^>]*>([\s\S]*?)<\/div>/.exec(answer.body)?.[1] ?? '';
    expect(root).toContain('<h1>Anish Rao</h1>');
    expect(root).toContain('<p>Designer &lt;/script&gt;&lt;script&gt;alert(1)&lt;/script&gt;</p>');
    expect(root).toContain('<a href="https://anish.design">Portfolio &lt;b&gt;</a>');
    expect(root).not.toContain('After dark');
    expect(root).not.toContain('mailto:');
    expect(ldOf(answer.body)).toBeDefined();
  });
});
