// The only links an email may carry: the app's own origin, and Powered by
// Timefix tagged with fixed words.
import { timefixUrl } from '@crm/contracts/brand';
import { describe, expect, it } from 'vitest';
import {
  appOrigin,
  appUrl,
  callUrl,
  EMAIL_MEDIUMS,
  onAppOrigin,
  poweredByUrl,
  TIMEFIX_SITE,
  wordmarkUrls,
  type EmailMedium,
} from './links.ts';

describe('Powered by Timefix', () => {
  it('tags www.timefix.com with the footer’s campaign and the email’s kind, and nothing else', () => {
    const url = new URL(poweredByUrl('email_sign_in'));
    expect(url.origin).toBe('https://www.timefix.com');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      utm_source: 'timefix',
      utm_medium: 'email_sign_in',
      utm_campaign: 'powered_by',
      utm_content: 'footer_logo',
    });
  });

  it('takes only the closed list of mediums, so nothing personal can ride in it', () => {
    for (const medium of EMAIL_MEDIUMS)
      expect(new URL(poweredByUrl(medium)).searchParams.get('utm_medium')).toBe(medium);
    for (const medium of ['sign_in', 'email_', 'email_acme_corp', 'email_a@b.example', 'email_ref=acme']) {
      expect(() => poweredByUrl(medium as EmailMedium), medium).toThrow('That isn’t an email medium.');
    }
  });

  it('refuses a public page’s medium: an email names its own family', () => {
    for (const medium of ['booking_page', 'booking_manage', 'form']) {
      expect(() => poweredByUrl(medium as EmailMedium), medium).toThrow('That isn’t an email medium.');
    }
  });

  it('is built by the one builder the public pages use, with no referrer', () => {
    expect(TIMEFIX_SITE).toBe('https://www.timefix.com');
    for (const medium of EMAIL_MEDIUMS) {
      expect(poweredByUrl(medium)).toBe(timefixUrl({ surface: medium }));
      expect(new URL(poweredByUrl(medium)).searchParams.has('ref')).toBe(false);
    }
  });
});

describe('app links', () => {
  it('joins an app path to the app’s origin', () => {
    expect(appUrl('https://app.example.com', '/w/acme/bookings?x=1')).toBe(
      'https://app.example.com/w/acme/bookings?x=1',
    );
    expect(appUrl('https://app.example.com/ignored/path', '/settings')).toBe('https://app.example.com/settings');
  });

  it('refuses anything that could leave the origin, or start with // once resolved', () => {
    for (const path of [
      '//evil.example/x',
      '/\\evil.example',
      'https://evil.example',
      'javascript:alert(1)',
      'w/acme',
      '/a b',
      '/..//evil.example',
      '/./%2e%2e//evil.example',
      '/a/../../..//evil.example',
      '/%2E/x',
    ]) {
      expect(() => appUrl('https://app.example.com', path), path).toThrow();
    }
    expect(() => appUrl('javascript:alert(1)', '/x')).toThrow();
  });

  it('links over https, or plain http on a laptop only', () => {
    expect(appOrigin('https://app.example.com/x')).toBe('https://app.example.com');
    expect(appOrigin('http://localhost:5173')).toBe('http://localhost:5173');
    expect(appOrigin('http://127.0.0.1:5230')).toBe('http://127.0.0.1:5230');
    expect(() => appOrigin('http://app.example.com')).toThrow();
    expect(() => appOrigin('ftp://app.example.com')).toThrow();
  });

  it('passes a link only when it is on the app origin, written as parsed', () => {
    const origin = 'https://app.example.com';
    expect(onAppOrigin('https://app.example.com/w/acme', origin)).toBe('https://app.example.com/w/acme');
    expect(onAppOrigin('HTTPS://APP.example.com/x', origin)).toBe('https://app.example.com/x');
    for (const link of [
      'https://evil.example/phish',
      'https://app.example.com@evil.example/login',
      'https://user:pass@app.example.com/x',
      'http://app.example.com/x',
      'https:evil.example',
      'https://app.example.com//evil.example',
      'javascript:alert(1)',
      'data:text/html,hi',
      '/relative',
    ]) {
      expect(() => onAppOrigin(link, origin), link).toThrow('An email link must be an address on the app origin.');
    }
  });

  it('lets a call button leave the app over https only, with no user or password', () => {
    expect(callUrl('https://meet.google.com/abc-defg-hij')).toBe('https://meet.google.com/abc-defg-hij');
    for (const link of ['http://meet.example/x', 'https://u:p@meet.example/x', 'javascript:alert(1)', 'meet.example']) {
      expect(() => callUrl(link), link).toThrow('A call link must be an https address.');
    }
  });

  it('serves the footer logo from the app, one file per theme', () => {
    expect(wordmarkUrls('https://app.example.com')).toEqual({
      light: 'https://app.example.com/brand/email/timefix-wordmark-light.png',
      dark: 'https://app.example.com/brand/email/timefix-wordmark-dark.png',
    });
  });
});
