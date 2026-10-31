// The host rules (spec 0064, AC-6401): one normal form, and a one line refusal for anything else.
import { describe, expect, it } from 'vitest';
import { apexOf, HOST_REFUSALS, normaliseHost } from './hosts.ts';

const OWN = ['app.timefix.com', 'timefix.com', 'brij-crm-phi.vercel.app', 'crm.example.org'];

describe('normaliseHost', () => {
  it.each([
    ['book.janedoe.com', 'book.janedoe.com', 'subdomain'],
    ['  Book.JaneDoe.COM  ', 'book.janedoe.com', 'subdomain'],
    ['https://book.janedoe.com/intro?x=1#top', 'book.janedoe.com', 'subdomain'],
    ['book.janedoe.com:443', 'book.janedoe.com', 'subdomain'],
    ['janedoe.com.', 'janedoe.com', 'apex'],
    ['janedoe.com', 'janedoe.com', 'apex'],
    ['janedoe.co.uk', 'janedoe.co.uk', 'apex'],
    ['book.janedoe.co.uk', 'book.janedoe.co.uk', 'subdomain'],
    ['münchen.de', 'xn--mnchen-3ya.de', 'apex'],
    ['www.janedoe.com', 'www.janedoe.com', 'subdomain'],
    ['book.example.test', 'book.example.test', 'subdomain'],
  ])('reads %s as %s (%s)', (typed, host, kind) => {
    expect(normaliseHost(typed, OWN)).toMatchObject({ ok: true, host, kind });
  });

  it.each([
    ['', 'malformed'],
    ['janedoe', 'malformed'],
    ['jane doe.com', 'malformed'],
    ['-jane.com', 'malformed'],
    ['jane_doe.com', 'malformed'],
    ['user@janedoe.com', 'malformed'],
    ['janedoe.com:http', 'malformed'],
    ['co.uk', 'malformed'],
    [`${'a'.repeat(64)}.com`, 'malformed'],
    ['10.0.0.5', 'ip'],
    ['https://192.168.1.1:8080/x', 'ip'],
    ['[::1]', 'ip'],
    ['::1', 'ip'],
    ['2001:db8::1', 'ip'],
    ['localhost', 'malformed'],
    ['printer.local', 'private'],
    ['box.internal', 'private'],
    ['app.localhost', 'private'],
    ['timefix.com', 'ours'],
    ['jane.timefix.com', 'ours'],
    ['timefix.ai', 'ours'],
    ['www.timefix.ai', 'ours'],
    ['brij-crm-phi.vercel.app', 'ours'],
    ['anything.vercel.app', 'ours'],
    ['vercel.com', 'ours'],
    ['crm.example.org', 'ours'],
    ['deep.crm.example.org', 'ours'],
  ])('refuses %s as %s, in one line', (typed, reason) => {
    const checked = normaliseHost(typed, OWN);
    expect(checked).toMatchObject({ ok: false, reason });
    if (!checked.ok) {
      expect(checked.message).toBe(HOST_REFUSALS[checked.reason]);
      expect(checked.message).not.toContain('\n');
    }
  });

  it('allows a host that only ends like one of ours', () => {
    expect(normaliseHost('nottimefix.com', OWN)).toMatchObject({ ok: true, host: 'nottimefix.com' });
  });
});

describe('apexOf', () => {
  it('takes the last two labels, or three under a two label suffix', () => {
    expect(apexOf('a.b.janedoe.com')).toBe('janedoe.com');
    expect(apexOf('book.janedoe.com.au')).toBe('janedoe.com.au');
  });
});
