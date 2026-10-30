import { describe, expect, it } from 'vitest';
import { CONVERT_REASONS, convertValue, type ConvertPhoneParser } from './convert.ts';
import { isTypeChange, TYPE_CHANGE_SPECS, TYPE_CHANGES, typeChangeTargets, typeKeyOf } from './type-changes.ts';
import { PICKER_TYPES } from './picker.ts';

const attribute = { isSystem: false, isPrimary: false };

/** A stand in for libphonenumber: "+44 7700 900123" and a bare UK number with GB as the default. */
const phone: ConvertPhoneParser = {
  parse: (text, defaultCountry) => {
    const digits = text.replaceAll(/[\s().-]/g, '');
    if (digits === '+447700900123') return { number: '+447700900123', country: 'GB' };
    if (digits === '07700900123' && defaultCountry === 'GB') return { number: '+447700900123', country: 'GB' };
    return undefined;
  },
};

describe('the safe type changes', () => {
  it('names only picker keys, each reachable through its spec', () => {
    const keys = new Set(PICKER_TYPES.map((entry) => entry.key));
    for (const [from, targets] of Object.entries(TYPE_CHANGES)) {
      expect(keys.has(from)).toBe(true);
      for (const to of targets) {
        expect(keys.has(to)).toBe(true);
        const spec = TYPE_CHANGE_SPECS[to];
        const entry = PICKER_TYPES.find((each) => each.key === to);
        expect(spec).toEqual({ type: entry?.type, isMulti: entry?.isMulti });
      }
    }
  });

  it('offers text its long, email, link and phone forms, and the reverse only for long text', () => {
    expect(typeChangeTargets({ ...attribute, type: 'text', isMulti: false })).toEqual([
      'long_text',
      'email',
      'link',
      'phone',
    ]);
    expect(typeChangeTargets({ ...attribute, type: 'long_text', isMulti: false })).toEqual(['text']);
    expect(typeChangeTargets({ ...attribute, type: 'email', isMulti: false })).toEqual([]);
  });

  it('offers a select its multi form, never the way back', () => {
    expect(typeChangeTargets({ ...attribute, type: 'select', isMulti: false })).toEqual(['multi_select']);
    expect(typeChangeTargets({ ...attribute, type: 'select', isMulti: true })).toEqual([]);
  });

  it('offers a number and a currency each other', () => {
    expect(typeChangeTargets({ ...attribute, type: 'number', isMulti: false })).toEqual(['currency']);
    expect(typeChangeTargets({ ...attribute, type: 'currency', isMulti: false })).toEqual(['number']);
  });

  it('offers nothing for a system attribute, the name, an archived one, or a type with no safe change', () => {
    expect(typeChangeTargets({ type: 'text', isMulti: false, isSystem: true, isPrimary: false })).toEqual([]);
    expect(typeChangeTargets({ type: 'text', isMulti: false, isSystem: false, isPrimary: true })).toEqual([]);
    expect(typeChangeTargets({ ...attribute, type: 'text', isMulti: false, isArchived: true })).toEqual([]);
    for (const type of ['date', 'checkbox', 'status', 'rating', 'location', 'actor_reference', 'record_reference']) {
      expect(typeChangeTargets({ ...attribute, type, isMulti: false })).toEqual([]);
    }
  });

  it('reads a type as its picker key', () => {
    expect(typeKeyOf({ type: 'select', isMulti: true })).toBe('multi_select');
    expect(typeKeyOf({ type: 'url', isMulti: false })).toBe('link');
    expect(typeKeyOf({ type: 'text', isMulti: false })).toBe('text');
    expect(isTypeChange('text', 'phone')).toBe(true);
    expect(isTypeChange('phone', 'text')).toBe(false);
  });
});

describe('convertValue', () => {
  it('keeps text as long text, unchanged', () => {
    expect(convertValue('text', 'long_text', 'Met at the fair')).toEqual({
      outcome: 'same',
      value: 'Met at the fair',
    });
  });

  it('turns long text into one line, and refuses what text can’t hold', () => {
    expect(convertValue('long_text', 'text', 'Short')).toEqual({ outcome: 'same', value: 'Short' });
    expect(convertValue('long_text', 'text', 'Line one\nLine two')).toEqual({
      outcome: 'converted',
      value: 'Line one Line two',
    });
    expect(convertValue('long_text', 'text', 'x'.repeat(501))).toEqual({
      outcome: 'empty',
      reason: CONVERT_REASONS.tooLong,
    });
  });

  it('holds a select’s option as a list of one', () => {
    const id = '0192f1c2-0000-7000-8000-000000000001';
    expect(convertValue('select', 'multi_select', id)).toEqual({ outcome: 'same', value: [id] });
  });

  it('gives a number the chosen currency, and drops the code going back', () => {
    expect(convertValue('number', 'currency', '1200.5', { defaultCurrency: 'EUR' })).toEqual({
      outcome: 'converted',
      value: { amount: '1200.5', currency: 'EUR' },
    });
    expect(convertValue('number', 'currency', '1200.5')).toEqual({
      outcome: 'empty',
      reason: CONVERT_REASONS.noCurrency,
    });
    expect(convertValue('number', 'currency', '5', { defaultCurrency: 'XXX' })).toEqual({
      outcome: 'empty',
      reason: CONVERT_REASONS.noCurrency,
    });
    expect(convertValue('currency', 'number', { amount: '99.99', currency: 'USD' })).toEqual({
      outcome: 'converted',
      value: '99.99',
    });
  });

  it('takes text as an email when it is one, lowercased', () => {
    expect(convertValue('text', 'email', 'ada@example.com')).toEqual({ outcome: 'same', value: 'ada@example.com' });
    expect(convertValue('text', 'email', 'Ada@Example.com')).toEqual({
      outcome: 'converted',
      value: 'ada@example.com',
    });
    expect(convertValue('text', 'email', 'Ada Lovelace')).toEqual({
      outcome: 'empty',
      reason: CONVERT_REASONS.notEmail,
    });
  });

  it('takes text as a link, adding https:// to a bare address', () => {
    expect(convertValue('text', 'link', 'https://acme.com/about')).toEqual({
      outcome: 'same',
      value: 'https://acme.com/about',
    });
    expect(convertValue('text', 'link', 'acme.com')).toEqual({ outcome: 'converted', value: 'https://acme.com' });
    expect(convertValue('text', 'link', 'not a link')).toEqual({ outcome: 'empty', reason: CONVERT_REASONS.notLink });
    expect(convertValue('text', 'link', 'ftp://acme.com')).toEqual({
      outcome: 'empty',
      reason: CONVERT_REASONS.notLink,
    });
  });

  it('takes text as a phone number through the parser, with the default country for a local one', () => {
    expect(convertValue('text', 'phone', '+44 7700 900123', { phone })).toEqual({
      outcome: 'converted',
      value: { number: '+447700900123', country: 'GB' },
    });
    expect(convertValue('text', 'phone', '07700 900123', { phone, defaultCountry: 'GB' })).toEqual({
      outcome: 'converted',
      value: { number: '+447700900123', country: 'GB' },
    });
    expect(convertValue('text', 'phone', '07700 900123', { phone })).toEqual({
      outcome: 'empty',
      reason: CONVERT_REASONS.notPhone,
    });
    // No parser: nothing can be read as a number.
    expect(convertValue('text', 'phone', '+44 7700 900123')).toEqual({
      outcome: 'empty',
      reason: CONVERT_REASONS.notPhone,
    });
  });

  it('refuses a pair outside the table', () => {
    expect(convertValue('email', 'text', 'ada@example.com')).toEqual({
      outcome: 'empty',
      reason: CONVERT_REASONS.notSupported,
    });
    expect(convertValue('multi_select', 'select', ['a'])).toEqual({
      outcome: 'empty',
      reason: CONVERT_REASONS.notSupported,
    });
  });
});
