// A view's four facts (spec 0061, AC-6116): what the page sent read again, anything outside its shape dropped.
import { describe, expect, it } from 'vitest';
import { countryFact, deviceFact, referrerFact, sourceFact, viewFacts } from './sources.ts';

const OWN = ['timefix.com', 'www.timefix.com', 'brij-crm-phi.vercel.app'];

describe('the facts a view carries', () => {
  it('keeps the referring host only, and Direct for none, our own origin, or anything that names no site', () => {
    expect(referrerFact('https://l.instagram.com/?u=https%3A%2F%2Ftimefix.com%2Fada&e=AT0', OWN)).toBe(
      'l.instagram.com',
    );
    expect(referrerFact('https://www.linkedin.com/feed/', OWN)).toBe('linkedin.com');
    expect(referrerFact('instagram.com', OWN)).toBe('instagram.com');
    expect(referrerFact('https://m.facebook.com/', OWN)).toBe('facebook.com');
    expect(referrerFact(undefined, OWN)).toBe('Direct');
    expect(referrerFact('', OWN)).toBe('Direct');
    expect(referrerFact('https://www.timefix.com/ada', OWN)).toBe('Direct');
    expect(referrerFact('https://brij-crm-phi.vercel.app/', OWN)).toBe('Direct');
    expect(referrerFact('android-app://com.google.android.gm/', OWN)).toBe('Direct');
    expect(referrerFact('https://192.168.1.1/', OWN)).toBe('192.168.1.1');
    expect(referrerFact('https://localhost/', OWN)).toBe('Direct');
    expect(referrerFact(`https://${'a'.repeat(63)}.${'b'.repeat(63)}.example`, OWN)).toBe('Direct');
    expect(referrerFact('<script>', OWN)).toBe('Direct');
  });

  it('keeps a utm_source lowercased, in its letters, and drops anything else', () => {
    expect(sourceFact('IG_Bio')).toBe('ig_bio');
    expect(sourceFact('newsletter.2026-11')).toBe('newsletter.2026-11');
    expect(sourceFact('a b')).toBeUndefined();
    expect(sourceFact('=cmd()')).toBeUndefined();
    expect(sourceFact('x'.repeat(61))).toBeUndefined();
    expect(sourceFact('')).toBeUndefined();
  });

  it('keeps two letters of country, and a device class from the agent', () => {
    expect(countryFact('gb')).toBe('GB');
    expect(countryFact('XX')).toBeUndefined();
    expect(countryFact('T1')).toBeUndefined();
    expect(countryFact('GBR')).toBeUndefined();
    expect(deviceFact('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe('mobile');
    expect(deviceFact('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)')).toBe('tablet');
    expect(deviceFact('Mozilla/5.0 (Linux; Android 14; SM-X710)')).toBe('tablet');
    expect(deviceFact('Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile')).toBe('mobile');
    expect(deviceFact('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)')).toBe('desktop');
  });

  it('answers the four together, and nothing of the agent itself', () => {
    expect(
      viewFacts({
        referrer: 'https://www.tiktok.com/@ada',
        source: 'TT',
        country: 'in',
        userAgent: 'Mozilla/5.0 (iPhone)',
        ownHosts: OWN,
      }),
    ).toEqual({ referrer: 'tiktok.com', source: 'tt', country: 'IN', device: 'mobile' });
    expect(viewFacts({ userAgent: 'curl', ownHosts: OWN })).toEqual({ referrer: 'Direct', device: 'desktop' });
  });
});
