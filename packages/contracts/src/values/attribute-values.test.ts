// AC-3: one schema per value shape. Valid samples parse into their canonical
// form, invalid ones are refused with the stable code and a sentence on how to
// fix them, and an empty value is null.
import { describe, expect, it } from 'vitest';
import {
  ATTRIBUTE_VALUE_INVALID,
  AttributeType,
  attributeValueSchema,
  DomainValue,
  emailDomain,
  fullNameOf,
  parseAttributeValue,
  PersonalNameValue,
  UrlValue,
} from './attribute-values.ts';
import { CURRENCY_CODES } from './currencies.ts';
import { toCanonicalDecimal } from './decimal.ts';

/** One valid input per type, and the canonical value it parses to. */
const VALID: Record<AttributeType, readonly [input: unknown, canonical: unknown]> = {
  text: ['  Ada\nLovelace ', 'Ada Lovelace'],
  long_text: [' First line\nSecond line ', 'First line\nSecond line'],
  number: ['+0012.50', '12.5'],
  currency: [
    { amount: '1234.50', currency: 'EUR' },
    { amount: '1234.5', currency: 'EUR' },
  ],
  date: ['2026-10-08', '2026-10-08'],
  timestamp: ['2026-10-01T09:30:00.000Z', '2026-10-01T09:30:00.000Z'],
  checkbox: [false, false],
  select: ['opt_1', 'opt_1'],
  status: ['st_2', 'st_2'],
  rating: [4, 4],
  email: [' Ada@Example.COM ', 'ada@example.com'],
  phone: [
    { number: '+447700900123', country: 'GB' },
    { number: '+447700900123', country: 'GB' },
  ],
  domain: ['Example.co.uk', 'example.co.uk'],
  url: ['HTTPS://Example.COM/Path?Q=A', 'https://example.com/Path?Q=A'],
  location: [
    { locality: 'London', countryCode: 'GB' },
    { locality: 'London', countryCode: 'GB' },
  ],
  personal_name: [
    { firstName: 'Ada', lastName: 'Lovelace' },
    { firstName: 'Ada', lastName: 'Lovelace', fullName: 'Ada Lovelace' },
  ],
  actor_reference: [
    { type: 'system', id: null },
    { type: 'system', id: null },
  ],
  record_reference: [
    { objectId: 'companies', recordId: 'rec_1' },
    { objectId: 'companies', recordId: 'rec_1' },
  ],
  file: [
    { fileId: 'f_1', name: 'Deck.pdf', size: 2048, contentType: 'Application/PDF' },
    { fileId: 'f_1', name: 'Deck.pdf', size: 2048, contentType: 'application/pdf' },
  ],
  interaction: [
    { kind: 'email', at: '2026-10-01T09:30:00.000Z', by: { type: 'member', id: 'mem_1' } },
    { kind: 'email', at: '2026-10-01T09:30:00.000Z', by: { type: 'member', id: 'mem_1' } },
  ],
};

/** One invalid input per type. */
const INVALID: Record<AttributeType, unknown> = {
  text: 'x'.repeat(501),
  long_text: '   ',
  number: '1.23456',
  currency: { amount: '10', currency: 'XXX' },
  date: '2026-02-29',
  timestamp: '2026-10-01T09:30:00Z',
  checkbox: 'yes',
  select: '',
  status: '  ',
  rating: 6,
  email: 'ada@example',
  phone: { number: '07700 900123', country: 'GB' },
  domain: 'exa mple.com',
  url: 'ftp://example.com',
  location: {},
  personal_name: { fullName: '' },
  actor_reference: { type: 'member', id: null },
  record_reference: { objectId: 'companies' },
  file: { fileId: 'f_1', name: 'a', size: -1, contentType: 'pdf' },
  interaction: { kind: 'call', at: '2026-10-01T09:30:00.000Z', by: { type: 'system', id: null } },
};

describe('attribute values', () => {
  for (const type of AttributeType.options) {
    it(`${type}: parses a valid value into its canonical form`, () => {
      const [input, canonical] = VALID[type];
      expect(parseAttributeValue(type, input)).toEqual({ ok: true, value: canonical });
    });

    it(`${type}: refuses an invalid value with ATTRIBUTE_VALUE_INVALID and how to fix it`, () => {
      const result = parseAttributeValue(type, INVALID[type]);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(ATTRIBUTE_VALUE_INVALID);
      expect(result.error.message).toMatch(/^[A-Z].*\.$/);
    });
  }

  it('takes null as empty for every type but checkbox, which is never empty', () => {
    for (const type of AttributeType.options) {
      expect(parseAttributeValue(type, null).ok, type).toBe(type !== 'checkbox');
    }
  });

  it('refuses an empty string and an empty list: empty is null', () => {
    expect(parseAttributeValue('text', '').ok).toBe(false);
    expect(parseAttributeValue('email', [], { allowMultiple: true }).ok).toBe(false);
  });

  it('holds a list of 1 to 100 unique values when the attribute allows several', () => {
    const schema = attributeValueSchema('email', { allowMultiple: true });
    expect(schema.parse(['B@x.com', 'a@x.com'])).toEqual(['b@x.com', 'a@x.com']);
    expect(schema.safeParse(['a@x.com', 'A@X.COM ']).success).toBe(false);
    expect(schema.safeParse(Array.from({ length: 101 }, (_, i) => `p${String(i)}@x.com`)).success).toBe(false);
  });

  it('compares objects in a list by their canonical form, whatever the key order', () => {
    const schema = attributeValueSchema('record_reference', { allowMultiple: true });
    expect(
      schema.safeParse([
        { objectId: 'people', recordId: 'r1' },
        { recordId: 'r1', objectId: 'people' },
      ]).success,
    ).toBe(false);
  });

  it('keeps types that are always single single, even when allowMultiple is set', () => {
    expect(attributeValueSchema('status', { allowMultiple: true }).safeParse(['a', 'b']).success).toBe(false);
  });
});

describe('Decimal', () => {
  it.each([
    ['0012.50', '12.5'],
    ['-0', '0'],
    ['-0.000', '0'],
    ['+7', '7'],
    ['-12.3400', '-12.34'],
    ['999999999999999.9999', '999999999999999.9999'],
  ])('%s becomes %s', (input, canonical) => {
    expect(toCanonicalDecimal(input)).toBe(canonical);
  });

  it.each(['1e5', '1,5', '1.23456', '1234567890123456', '', '.5', '5.'])('refuses %s', (input) => {
    expect(toCanonicalDecimal(input)).toBeUndefined();
  });
});

describe('the edge cases the editors rely on', () => {
  it('domains: strips nothing itself, and refuses a path, a trailing dot or a single label', () => {
    expect(DomainValue.safeParse('example.com/about').success).toBe(false);
    expect(DomainValue.safeParse('example.com.').success).toBe(false);
    expect(DomainValue.safeParse('localhost').success).toBe(false);
    expect(DomainValue.parse('xn--bcher-kva.de')).toBe('xn--bcher-kva.de');
    expect(DomainValue.safeParse('bücher.de').success).toBe(false);
  });

  it('URLs: lowercase only the scheme and host, keep user info as typed', () => {
    expect(UrlValue.parse('http://Ada@Example.com:8080/A')).toBe('http://Ada@example.com:8080/A');
    expect(UrlValue.safeParse('example.com').success).toBe(false);
    expect(UrlValue.safeParse(`https://x.com/${'a'.repeat(2050)}`).success).toBe(false);
  });

  it('names: the full name defaults to first and last joined', () => {
    expect(PersonalNameValue.parse({ lastName: 'Hopper' }).fullName).toBe('Hopper');
    expect(PersonalNameValue.parse({ firstName: 'Grace', fullName: 'Rear Admiral Grace Hopper' }).fullName).toBe(
      'Rear Admiral Grace Hopper',
    );
    expect(fullNameOf(' Ada ', undefined)).toBe('Ada');
  });

  it('locations: a latitude needs its longitude, and both stay in range', () => {
    expect(parseAttributeValue('location', { latitude: '51.5' }).ok).toBe(false);
    expect(parseAttributeValue('location', { latitude: '91', longitude: '0' }).ok).toBe(false);
    expect(parseAttributeValue('location', { latitude: '51.5072', longitude: '-0.1276' }).ok).toBe(true);
  });

  it('emails: the domain helper reads after the last @', () => {
    expect(emailDomain('ada@example.com')).toBe('example.com');
  });

  it('currencies: a fixed list of three letter codes, with no withdrawn ones', () => {
    expect(CURRENCY_CODES.every((code) => /^[A-Z]{3}$/.test(code))).toBe(true);
    expect(new Set(CURRENCY_CODES).size).toBe(CURRENCY_CODES.length);
    for (const withdrawn of ['BGN', 'HRK', 'ZWL', 'SLL', 'CUC']) expect(CURRENCY_CODES).not.toContain(withdrawn);
  });
});
