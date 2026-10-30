import { describe, expect, it } from 'vitest';
import { FIELD_SAMPLES } from '../../workbench/field-samples.ts';
import { currencyType } from '../Currency/type.ts';
import type { TextContext } from '../types.ts';
import { isRefusal } from '../values.ts';
import { numberType } from './type.ts';

const number = (locale: string): TextContext => ({
  locale,
  timeZone: 'UTC',
  attribute: FIELD_SAMPLES.number.attribute,
});
const currency = (locale: string): TextContext => ({
  locale,
  timeZone: 'UTC',
  attribute: { ...FIELD_SAMPLES.currency.attribute, defaultCurrency: 'EUR' },
});

describe('a pasted number that reads two ways', () => {
  it('is refused with both readings in US English', () => {
    expect(numberType.fromText('1.200', number('en-US'))).toMatchObject({ reason: 'Is it 1.2 or 1,200?' });
    expect(numberType.fromText('1,200', number('en-US'))).toBe('1200');
    expect(numberType.fromText('0.125', number('en-US'))).toBe('0.125');
  });

  it('is refused with both readings in German', () => {
    expect(numberType.fromText('1,200', number('de-DE'))).toMatchObject({ reason: 'Is it 1,2 or 1.200?' });
    expect(numberType.fromText('1.200', number('de-DE'))).toBe('1200');
  });

  it('refuses an amount the same way', () => {
    expect(isRefusal(currencyType.fromText('€1,200', currency('de-DE')))).toBe(true);
    expect(currencyType.fromText('€1.200', currency('de-DE'))).toEqual({ amount: '1200', currency: 'EUR' });
  });

  it('copies three decimals so they paste back as themselves', () => {
    for (const locale of ['en-US', 'de-DE']) {
      const text = numberType.toText('1.234', number(locale));
      expect(numberType.fromText(text, number(locale))).toBe('1.234');
      const amount = currencyType.toText({ amount: '1.234', currency: 'EUR' }, currency(locale));
      expect(currencyType.fromText(amount, currency(locale))).toEqual({ amount: '1.234', currency: 'EUR' });
    }
  });
});
