// Intent preloading (preload.ts) against stand in elements and a stand in clock: which addresses a pointer, a focus
// or a touch preloads, and when.
import { describe, expect, it } from 'vitest';
import { intentHref, startIntentPreload } from './preload.ts';

const ORIGIN = 'https://app.example';

/** A stand in element: `closest` finds itself when it has one of the attributes asked for. */
function element(attributes: Readonly<Record<string, string>>) {
  const self = {
    getAttribute: (name: string) => attributes[name] ?? null,
    closest: (selector: string) =>
      (selector.includes('a[href]') && 'href' in attributes) ||
      (selector.includes('[data-href]') && 'data-href' in attributes)
        ? self
        : null,
  };
  return self;
}

describe('intentHref', () => {
  it('answers a link’s in app address, and a tab’s or row’s data-href', () => {
    expect(intentHref(element({ href: '/w/acme/captures/links' }), ORIGIN)).toBe('/w/acme/captures/links');
    expect(intentHref(element({ href: `${ORIGIN}/w/acme/bookings/list?tab=past` }), ORIGIN)).toBe(
      '/w/acme/bookings/list?tab=past',
    );
    expect(intentHref(element({ 'data-href': '/w/acme/captures/forms' }), ORIGIN)).toBe('/w/acme/captures/forms');
  });

  it('leaves out other origins, the API, new tabs, downloads, bare hashes and anything not a link', () => {
    expect(intentHref(element({ href: 'https://elsewhere.example/w/acme' }), ORIGIN)).toBeUndefined();
    expect(intentHref(element({ href: '/api/rpc/me/get' }), ORIGIN)).toBeUndefined();
    expect(intentHref(element({ href: '/w/acme/captures/links', target: '_blank' }), ORIGIN)).toBeUndefined();
    expect(intentHref(element({ href: '/export.csv', download: '' }), ORIGIN)).toBeUndefined();
    expect(intentHref(element({ href: '#main' }), ORIGIN)).toBeUndefined();
    expect(intentHref(element({}), ORIGIN)).toBeUndefined();
    expect(intentHref(null, ORIGIN)).toBeUndefined();
    expect(intentHref({ textContent: 'text' }, ORIGIN)).toBeUndefined();
  });
});

/** A stand in document and clock: dispatch events by type, run timers by hand. */
function host() {
  const listeners = new Map<string, (event: Event) => void>();
  const timers = new Map<number, () => void>();
  let next = 0;
  const preloaded: string[] = [];
  const stop = startIntentPreload({
    target: {
      addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
        listeners.set(type, listener as (event: Event) => void);
      },
      removeEventListener: (type: string) => {
        listeners.delete(type);
      },
    },
    origin: ORIGIN,
    preload: (href) => {
      preloaded.push(href);
    },
    delayMs: 50,
    setTimer: (run) => {
      next += 1;
      timers.set(next, run);
      return next;
    },
    clearTimer: (timer) => {
      timers.delete(timer);
    },
  });
  const fire = (type: string, target: unknown, relatedTarget?: unknown) => {
    listeners.get(type)?.({ target, relatedTarget } as unknown as Event);
  };
  const elapse = () => {
    const due = [...timers.values()];
    timers.clear();
    for (const run of due) run();
  };
  return { fire, elapse, preloaded, stop, listeners };
}

describe('startIntentPreload', () => {
  const links = element({ href: '/w/acme/captures/links' });
  const forms = element({ 'data-href': '/w/acme/captures/forms' });

  it('preloads a link a pointer rests on, once the delay passes', () => {
    const { fire, elapse, preloaded } = host();
    fire('pointerover', links);
    expect(preloaded).toEqual([]);
    elapse();
    expect(preloaded).toEqual(['/w/acme/captures/links']);
  });

  it('cancels when the pointer leaves first, and keeps waiting while it moves within the same link', () => {
    const { fire, elapse, preloaded } = host();
    fire('pointerover', links);
    fire('pointerout', links, links);
    fire('pointerover', links);
    fire('pointerout', links, element({}));
    elapse();
    expect(preloaded).toEqual([]);
  });

  it('preloads at once on keyboard focus and on a touch', () => {
    const { fire, preloaded } = host();
    fire('focusin', forms);
    fire('touchstart', links);
    expect(preloaded).toEqual(['/w/acme/captures/forms', '/w/acme/captures/links']);
  });

  it('stops listening', () => {
    const { stop, listeners } = host();
    stop();
    expect(listeners.size).toBe(0);
  });
});
