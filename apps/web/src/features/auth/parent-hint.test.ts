// The parent domain session hint: presence and an expiry, on the one domain the apex can read, and nothing else.
import { describe, expect, it } from 'vitest';
import {
  bookingHost,
  hintCookie,
  hintCookieDomain,
  SESSION_HINT_COOKIE,
  SESSION_HINT_PRESENT,
  writeParentSessionHint,
  type HintPage,
} from './parent-hint.ts';

function page(host: string, protocol = 'https:'): { page: HintPage; written: string[] } {
  const written: string[] = [];
  return {
    page: {
      host,
      protocol,
      writeCookie: (cookie) => {
        written.push(cookie);
      },
    },
    written,
  };
}

describe('the domain the hint is written on', () => {
  it('is the booking host itself, the apex the app sits under', () => {
    expect(hintCookieDomain('app.timefix.com', 'timefix.com', 'https:')).toBe('timefix.com');
    expect(hintCookieDomain('APP.TIMEFIX.COM', 'TIMEFIX.COM', 'https:')).toBe('timefix.com');
  });

  it('is nothing while one host serves both, as a preview and a laptop do', () => {
    expect(hintCookieDomain('app.timefix.com', 'app.timefix.com', 'https:')).toBeUndefined();
    expect(hintCookieDomain('brij-crm-phi.vercel.app', undefined, 'https:')).toBeUndefined();
    expect(hintCookieDomain('brij-crm-phi.vercel.app', '', 'https:')).toBeUndefined();
    expect(hintCookieDomain('localhost:5173', 'localhost:5173', 'http:')).toBeUndefined();
  });

  it('is nothing off https, so the hint never travels in the clear', () => {
    expect(hintCookieDomain('app.timefix.com', 'timefix.com', 'http:')).toBeUndefined();
  });

  it('is nothing unless the app is a name under the booking host itself', () => {
    expect(hintCookieDomain('app.timefix.com', 'timefix.test', 'https:')).toBeUndefined();
    expect(hintCookieDomain('timefix.com', 'other.com', 'https:')).toBeUndefined();
    // The app itself is the parent: a cookie on it would be the host only one it already has.
    expect(hintCookieDomain('timefix.com', 'book.timefix.com', 'https:')).toBeUndefined();
    // Only sharing a parent is never enough, so the cookie can't land on a domain others share.
    expect(hintCookieDomain('app.timefix.com', 'book.timefix.com', 'https:')).toBeUndefined();
    expect(hintCookieDomain('one.somehost.com', 'two.somehost.com', 'https:')).toBeUndefined();
    expect(hintCookieDomain('a.vercel.app', 'b.vercel.app', 'https:')).toBeUndefined();
    // A label boundary, never a suffix of the text: `nottimefix.com` is not under `timefix.com`.
    expect(hintCookieDomain('nottimefix.com', 'timefix.com', 'https:')).toBeUndefined();
    expect(hintCookieDomain('', 'timefix.com', 'https:')).toBeUndefined();
  });

  it('is nothing for a host that is a port or an address rather than a name', () => {
    expect(hintCookieDomain('app.timefix.com:8443', 'timefix.com:8443', 'https:')).toBeUndefined();
    expect(hintCookieDomain('10.168.1.5', '168.1.5', 'https:')).toBeUndefined();
    expect(hintCookieDomain('app.localhost', 'localhost', 'https:')).toBeUndefined();
  });

  it('reads the booking host off the origin the build baked in', () => {
    expect(bookingHost('https://timefix.com')).toBe('timefix.com');
    expect(bookingHost('')).toBeUndefined();
    expect(bookingHost(undefined)).toBeUndefined();
    expect(bookingHost('not a url')).toBeUndefined();
  });
});

describe('the cookie itself', () => {
  it('says presence and an expiry, and nothing of anyone’s', () => {
    const cookie = hintCookie('timefix.com', true);
    expect(cookie).toBe(
      `${SESSION_HINT_COOKIE}=${SESSION_HINT_PRESENT}; Max-Age=2592000; Domain=timefix.com; Path=/; Secure; SameSite=Lax`,
    );
    // No longer than a session can last (the API's expiresIn: 30 days).
    expect(cookie).toContain(`Max-Age=${String(30 * 24 * 60 * 60)}`);
  });

  it('is cleared at once when nobody is signed in', () => {
    expect(hintCookie('timefix.com', false)).toBe(
      `${SESSION_HINT_COOKIE}=; Max-Age=0; Domain=timefix.com; Path=/; Secure; SameSite=Lax`,
    );
  });
});

describe('writing it', () => {
  it('writes once on the parent domain when a session begins', () => {
    const { page: at, written } = page('app.timefix.com');
    writeParentSessionHint(at, 'https://timefix.com', true);
    expect(written).toEqual([hintCookie('timefix.com', true)]);
  });

  it('clears it when nobody is signed in', () => {
    const { page: at, written } = page('app.timefix.com');
    writeParentSessionHint(at, 'https://timefix.com', false);
    expect(written).toEqual([hintCookie('timefix.com', false)]);
  });

  it('writes nothing without a parent domain to write on', () => {
    const { page: preview, written } = page('brij-crm-phi.vercel.app');
    writeParentSessionHint(preview, '', true);
    expect(written).toEqual([]);
    const { page: local, written: none } = page('localhost:5173', 'http:');
    writeParentSessionHint(local, 'http://localhost:5173', true);
    expect(none).toEqual([]);
  });

  it('never throws when the browser refuses cookies', () => {
    const refusing: HintPage = {
      host: 'app.timefix.com',
      protocol: 'https:',
      writeCookie: () => {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    };
    expect(() => {
      writeParentSessionHint(refusing, 'https://timefix.com', true);
    }).not.toThrow();
    expect(() => {
      writeParentSessionHint(undefined, 'https://timefix.com', true);
    }).not.toThrow();
  });
});
