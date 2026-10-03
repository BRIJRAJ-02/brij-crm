// The sign in pages' rules without a browser: which redirects are honoured
// (spec 0005: only a path that starts with a single `/`), the pending email's
// storage, and the resend countdown.
import { dataError } from '@crm/data';
import { describe, expect, it } from 'vitest';
import { googleRefusal, resendRefusal, sendRefusal, verifyRefusal } from './messages.ts';
import { clearPending, readLastEmail, readPending, saveLastEmail, savePending } from './pending.ts';
import { redirectSearch, safeRedirect, signInHref } from './redirect.ts';
import { strings } from './strings.ts';
import { secondsLeft } from './useSecondsLeft.ts';
import { firstResendAt } from './VerifyScreen.tsx';

describe('safeRedirect', () => {
  it.each(['/w/acme/objects/people', '/welcome', '/w/acme?view=all#top', '/status'])(
    'honours the app path %s',
    (path) => {
      expect(safeRedirect(path)).toBe(path);
    },
  );

  it.each([
    ['another host', '//evil.example/steal'],
    ['a backslash host', '/\\evil.example'],
    ['an absolute URL', 'https://evil.example'],
    ['a script URL', 'javascript:alert(1)'],
    ['a relative path', 'w/acme'],
    ['a space', '/w/ acme'],
    ['a tab', '/w/\tacme'],
    ['a sign in page', '/sign-in?redirect=/w/acme'],
    ['the verify page', '/verify'],
    ['a sign in page in capitals', '/SIGN-IN'],
    ['an escaped sign in page', '/%73ign-in'],
    ['a sign in page reached through ..', '/w/../verify'],
    ['a path that resolves to another host', '/.//evil.example'],
    ['an escaped second slash', '/%2F%2Fevil.example'],
    ['a malformed escape', '/w/%E0%A4%A'],
    ['nothing', undefined],
    ['a number', 42],
  ])('sends %s to /', (_name, value) => {
    expect(safeRedirect(value)).toBe('/');
  });

  it('hands back the path as resolved', () => {
    expect(safeRedirect('/w/acme/./objects/people')).toBe('/w/acme/objects/people');
  });

  it('builds the sign in address with the page to come back to', () => {
    expect(signInHref('/w/acme/objects/people')).toBe('/sign-in?redirect=%2Fw%2Facme%2Fobjects%2Fpeople');
    expect(signInHref('/')).toBe('/sign-in');
    expect(signInHref('//evil.example')).toBe('/sign-in');
  });
});

/** A sessionStorage stand in, optionally one that refuses every call. */
function memoryStorage(refuse = false): Storage {
  const items = new Map<string, string>();
  const guard = () => {
    if (refuse) throw new Error('The storage is blocked.');
  };
  return {
    get length() {
      return items.size;
    },
    clear: () => {
      guard();
      items.clear();
    },
    getItem: (key) => {
      guard();
      return items.get(key) ?? null;
    },
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => {
      guard();
      items.delete(key);
    },
    setItem: (key, value) => {
      guard();
      items.set(key, value);
    },
  };
}

describe('the pending sign in', () => {
  it('keeps the address and when the code went, until it is cleared', () => {
    const storage = memoryStorage();
    expect(readPending(storage)).toBeUndefined();
    savePending(storage, { email: 'ada@example.com', sentAt: 1_000 });
    expect(readPending(storage)).toEqual({ email: 'ada@example.com', sentAt: 1_000 });
    clearPending(storage);
    expect(readPending(storage)).toBeUndefined();
  });

  it('reads nothing from blocked, missing or garbled storage, and never throws', () => {
    const blocked = memoryStorage(true);
    savePending(blocked, { email: 'ada@example.com', sentAt: 1 });
    expect(readPending(blocked)).toBeUndefined();
    expect(() => {
      clearPending(blocked);
    }).not.toThrow();
    expect(readPending(undefined)).toBeUndefined();
    const garbled = memoryStorage();
    garbled.setItem('crm.signIn.pending', '{not json');
    expect(readPending(garbled)).toBeUndefined();
    garbled.setItem('crm.signIn.pending', JSON.stringify({ email: 42, sentAt: 'soon' }));
    expect(readPending(garbled)).toBeUndefined();
  });
});

describe('secondsLeft', () => {
  it('counts whole seconds up to the moment, and stops at zero', () => {
    expect(secondsLeft(60_000, 0)).toBe(60);
    expect(secondsLeft(60_000, 500)).toBe(60);
    expect(secondsLeft(60_000, 59_001)).toBe(1);
    expect(secondsLeft(60_000, 60_000)).toBe(0);
    expect(secondsLeft(60_000, 90_000)).toBe(0);
  });
});

describe('redirectSearch', () => {
  it('keeps redirect and a short error code, and nothing else', () => {
    expect(redirectSearch({ redirect: '/w/acme', error: 'access_denied', other: 'x' })).toEqual({
      redirect: '/w/acme',
      error: 'access_denied',
    });
    expect(redirectSearch({ redirect: 42, error: '' })).toEqual({});
    expect(redirectSearch({ error: 'x'.repeat(65) })).toEqual({});
  });
});

describe('the address kept for /sign-in', () => {
  it('is kept by "Use another email" and forgotten once a sign in clears the pending one', () => {
    const storage = memoryStorage();
    expect(readLastEmail(storage)).toBeUndefined();
    saveLastEmail(storage, 'ada@exmaple.com');
    expect(readLastEmail(storage)).toBe('ada@exmaple.com');
    clearPending(storage);
    expect(readLastEmail(storage)).toBeUndefined();
    expect(readLastEmail(memoryStorage(true))).toBeUndefined();
  });
});

describe('what a refused step says', () => {
  it('gives the real wait for a rate limited send, and the server’s words without one', () => {
    expect(sendRefusal(dataError('RATE_LIMITED', 'Too many codes.', undefined, 600))).toBe(
      'Too many codes sent to this email. Try again in 10 minutes.',
    );
    expect(sendRefusal(dataError('RATE_LIMITED', 'Too many codes.'))).toBe('Too many codes.');
    expect(sendRefusal(dataError('API_UNAVAILABLE', 'Can’t reach the CRM.'))).toBe('Can’t reach the CRM.');
  });

  it('leaves the wait out of a rate limited resend, since the wait line counts it', () => {
    expect(resendRefusal(dataError('RATE_LIMITED', 'Too many codes.', undefined, 600))).toBe(
      'Too many codes sent to this email.',
    );
    expect(resendRefusal(dataError('RATE_LIMITED', 'Too many codes.'))).toBe('Too many codes.');
    expect(resendRefusal(dataError('API_UNAVAILABLE', 'Can’t reach the CRM.'))).toBe('Can’t reach the CRM.');
  });

  it('says plainly that sign up is closed', () => {
    expect(sendRefusal(dataError('SIGNUP_CLOSED', "Sign up isn't open yet."))).toBe(
      'There’s no account for this email, and sign up isn’t open yet. Check the address.',
    );
  });

  it('spends the code after too many tries, an expired code or a rate limit, never after a wrong one', () => {
    expect(verifyRefusal(dataError('TOO_MANY_ATTEMPTS', 'Too many.'), false).isSpent).toBe(true);
    expect(verifyRefusal(dataError('OTP_EXPIRED', 'Expired.'), false).isSpent).toBe(true);
    expect(verifyRefusal(dataError('RATE_LIMITED', 'Slow down.', undefined, 3600), false)).toEqual({
      message: 'Too many sign in tries for this email. Try again in 60 minutes.',
      isSpent: true,
    });
    expect(verifyRefusal(dataError('INVALID_OTP', 'Wrong. Check it, or send a new one.'), false)).toEqual({
      message: 'Wrong. Check it, or send a new one.',
      isSpent: false,
    });
  });

  it('doesn’t offer a new code for a wrong one while none can be sent', () => {
    expect(verifyRefusal(dataError('INVALID_OTP', 'Wrong. Check it, or send a new one.'), true).message).toBe(
      'That code isn’t right. Try again.',
    );
  });

  it('says a refused Google sign in in its own words, never the code', () => {
    expect(googleRefusal('access_denied')).toBe(strings.googleCancelled);
    expect(googleRefusal('unable_to_create_user')).toBe(strings.googleSignUpClosed);
    expect(googleRefusal('<script>')).toBe(strings.googleFailed);
  });

  it('writes waits in whole units, rounded up', () => {
    expect(strings.duration(1)).toBe('1 second');
    expect(strings.duration(45)).toBe('45 seconds');
    expect(strings.duration(60)).toBe('60 seconds');
    expect(strings.duration(61)).toBe('2 minutes');
    expect(strings.duration(600)).toBe('10 minutes');
    expect(strings.duration(86_400)).toBe('24 hours');
  });
});

describe('firstResendAt', () => {
  it('is a minute after the code went, and never more than a minute away', () => {
    expect(firstResendAt(1_000, 30_000)).toBe(61_000);
    // A sentAt from a clock ahead of this one.
    expect(firstResendAt(90_000, 30_000)).toBe(90_000);
  });
});
