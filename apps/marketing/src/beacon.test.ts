// The visit beacon (spec 0047, AC-1627): the path without its query, another site's host, the source, and nothing
// under automation or without an endpoint.
import { describe, expect, it } from 'vitest';
import { sendVisit, visitOf } from './beacon.ts';

describe('visitOf', () => {
  it('keeps the path, the referring site and the utm_source, and drops the query and the same site', () => {
    expect(
      visitOf(
        'https://www.timefix.com/privacy?email=ada@example.com&utm_source=newsletter',
        'https://www.google.com/search?q=x',
      ),
    ).toEqual({
      path: '/privacy',
      referrer: 'www.google.com',
      source: 'newsletter',
    });
    expect(visitOf('https://www.timefix.com/', 'https://www.timefix.com/terms')).toEqual({ path: '/' });
    expect(visitOf('https://www.timefix.com/', 'not a url')).toEqual({ path: '/' });
  });
});

describe('sendVisit', () => {
  it('sends plain text once, and nothing under automation or without an endpoint', async () => {
    const sent: { url: string; body: Blob }[] = [];
    const host = (isAutomated: boolean) => ({
      href: 'https://www.timefix.com/',
      referrer: '',
      isAutomated,
      send: (url: string, body: Blob) => {
        sent.push({ url, body });
        return true;
      },
    });
    expect(sendVisit('https://app.timefix.com/api/public/site/hit', host(false))).toBe(true);
    expect(sendVisit('https://app.timefix.com/api/public/site/hit', host(true))).toBe(false);
    expect(sendVisit(undefined, host(false))).toBe(false);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.body.type).toBe('text/plain');
    expect(JSON.parse(await (sent[0]?.body.text() ?? Promise.resolve('')))).toEqual({ path: '/' });
  });
});
