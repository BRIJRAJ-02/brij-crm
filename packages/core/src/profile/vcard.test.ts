// The contact card's vCard (spec 0051, AC-5114): RFC 6350 escaping, folding at 75 octets of UTF-8, CRLF endings,
// only the fields given, and the picture as base64 when it is a type a vCard names.
import { describe, expect, it } from 'vitest';
import { escapeVcardText, foldVcardLine, writeVcard } from './vcard.ts';

const octets = (text: string) => new TextEncoder().encode(text).length;

describe('writeVcard', () => {
  it('writes every field given, and nothing for the ones left out', () => {
    const vcard = writeVcard({
      fullName: 'Anish Gupta',
      jobTitle: 'Cofounder',
      company: 'Timefix',
      email: 'anish@timefix.com',
      phone: '+91 99999 99999',
      website: 'https://www.timefix.com',
      note: 'Met at SaaSBoomi',
    });
    expect(vcard.split('\r\n')).toEqual([
      'BEGIN:VCARD',
      'VERSION:3.0',
      'N:Gupta;Anish;;;',
      'FN:Anish Gupta',
      'ORG:Timefix',
      'TITLE:Cofounder',
      'EMAIL;TYPE=INTERNET:anish@timefix.com',
      'TEL;TYPE=CELL:+91 99999 99999',
      'URL:https://www.timefix.com',
      'NOTE:Met at SaaSBoomi',
      'END:VCARD',
      '',
    ]);
    expect(writeVcard({ fullName: 'Cher' }).split('\r\n')).toEqual([
      'BEGIN:VCARD',
      'VERSION:3.0',
      'N:;Cher;;;',
      'FN:Cher',
      'END:VCARD',
      '',
    ]);
  });

  it('carries the link page\u2019s own address after the card\u2019s website, and never twice', () => {
    const page = 'https://timefix.com/anish';
    const both = writeVcard({ fullName: 'Anish Gupta', website: 'https://www.timefix.com' }, undefined, page);
    expect(both.split('\r\n').filter((line) => line.startsWith('URL:'))).toEqual([
      'URL:https://www.timefix.com',
      `URL:${page}`,
    ]);
    // No website of their own: the page is the one address the card carries.
    expect(writeVcard({ fullName: 'Anish Gupta' }, undefined, page)).toContain(`URL:${page}`);
    // The website is already the page: one line, not the same address twice.
    expect(
      writeVcard({ fullName: 'Anish Gupta', website: page }, undefined, page)
        .split('\r\n')
        .filter((line) => line.startsWith('URL:')),
    ).toEqual([`URL:${page}`]);
  });

  it('escapes what a reader would split on, so a value never becomes another field', () => {
    expect(escapeVcardText('Sales; Ops, and \\ more\nEND:VCARD')).toBe('Sales\\; Ops\\, and \\\\ more\\nEND:VCARD');
    const vcard = writeVcard({ fullName: 'Ada; Byron', company: 'Acme, Inc.', website: 'https://a.dev/x,y;z' });
    expect(vcard).toContain('N:Byron;Ada\\;;;;');
    expect(vcard).toContain('ORG:Acme\\, Inc.');
    expect(vcard).toContain('URL:https://a.dev/x%2Cy%3Bz');
    expect(vcard.match(/END:VCARD/g)).toHaveLength(1);
  });

  it('folds at 75 octets without splitting a character, each further line starting with a space', () => {
    const long = `NOTE:${'é'.repeat(60)}${'😀'.repeat(10)}`;
    const folded = foldVcardLine(long);
    const lines = folded.split('\r\n');
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(octets(line)).toBeLessThanOrEqual(75);
    for (const line of lines.slice(1)) expect(line.startsWith(' ')).toBe(true);
    expect(lines.map((line, index) => (index === 0 ? line : line.slice(1))).join('')).toBe(long);
    expect(foldVcardLine('FN:Ada')).toBe('FN:Ada');
  });

  it('embeds a JPEG, PNG or GIF picture as base64, folded, and leaves a WebP out', () => {
    const bytes = new Uint8Array(200).map((_, index) => index);
    const vcard = writeVcard({ fullName: 'Ada' }, { type: 'image/jpeg', bytes });
    const unfolded = vcard.replace(/\r\n /g, '');
    expect(unfolded).toContain(`PHOTO;ENCODING=b;TYPE=JPEG:${Buffer.from(bytes).toString('base64')}\r\n`);
    for (const line of vcard.split('\r\n')) expect(octets(line)).toBeLessThanOrEqual(75);
    expect(writeVcard({ fullName: 'Ada' }, { type: 'image/webp', bytes })).not.toContain('PHOTO');
  });

  // Three of each way to reach the person (26 October 2026): EMAIL, TEL and URL all repeat in RFC 6350, so one
  // card is still one person in an address book.
  it('writes a line for every email, phone and website the card carries, in the card’s own order', () => {
    const vcard = writeVcard({
      fullName: 'Ada Lovelace',
      email: 'ada@work.com',
      email2: 'ada@home.com',
      email3: 'ada@notes.dev',
      phone: '+442079460000',
      phone2: '+447700900123',
      website: 'https://ada.dev',
      website2: 'https://notes.ada.dev',
    });
    const lines = vcard.split('\r\n');
    expect(lines.filter((line) => line.startsWith('EMAIL'))).toEqual([
      'EMAIL;TYPE=INTERNET:ada@work.com',
      'EMAIL;TYPE=INTERNET:ada@home.com',
      'EMAIL;TYPE=INTERNET:ada@notes.dev',
    ]);
    // The first number is the one a reader rings; nothing on the card says the rest are mobiles, so they say
    // VOICE rather than guessing CELL and putting the wrong word in somebody's address book.
    expect(lines.filter((line) => line.startsWith('TEL'))).toEqual([
      'TEL;TYPE=CELL:+442079460000',
      'TEL;TYPE=VOICE:+447700900123',
    ]);
    expect(lines.filter((line) => line.startsWith('URL'))).toEqual([
      'URL:https://ada.dev',
      'URL:https://notes.ada.dev',
    ]);
  });

  it('closes a gap, and writes the page’s own address only when the card does not already carry it', () => {
    // A second website cleared but a third kept is still two websites: the card is read in order, gaps closed.
    const gapped = writeVcard({ fullName: 'Ada', website: 'https://ada.dev', website3: 'https://notes.ada.dev' });
    expect(gapped.split('\r\n').filter((line) => line.startsWith('URL'))).toEqual([
      'URL:https://ada.dev',
      'URL:https://notes.ada.dev',
    ]);
    const page = 'https://timefix.com/ada';
    const carried = writeVcard({ fullName: 'Ada', website: 'https://ada.dev', website2: page }, undefined, page);
    expect(carried.split('\r\n').filter((line) => line === `URL:${page}`)).toHaveLength(1);
    const missing = writeVcard({ fullName: 'Ada', website: 'https://ada.dev' }, undefined, page);
    expect(missing).toContain(`URL:${page}`);
  });
});
