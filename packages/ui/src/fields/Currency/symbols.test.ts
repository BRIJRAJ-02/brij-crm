import { describe, expect, it } from 'vitest';
import { withCurrencyCode } from './symbols.ts';

describe('withCurrencyCode', () => {
  it('turns each symbol before an amount into its code', () => {
    expect(withCurrencyCode('$1,200', undefined)).toBe('USD 1,200');
    expect(withCurrencyCode('€900', undefined)).toBe('EUR 900');
    expect(withCurrencyCode('£5', undefined)).toBe('GBP 5');
    expect(withCurrencyCode('₹500', undefined)).toBe('INR 500');
    expect(withCurrencyCode('¥300', undefined)).toBe('JPY 300');
  });

  it('reads a symbol after the amount, and a minus before the symbol', () => {
    expect(withCurrencyCode('900 €', undefined)).toBe('EUR 900');
    expect(withCurrencyCode('-$5.50', undefined)).toBe('USD -5.50');
  });

  it('gives "$" the default when that is a dollar, and "¥" CNY when that is the default', () => {
    expect(withCurrencyCode('$40', 'CAD')).toBe('CAD 40');
    expect(withCurrencyCode('$40', 'EUR')).toBe('USD 40');
    expect(withCurrencyCode('¥40', 'CNY')).toBe('CNY 40');
  });

  it('leaves text with no symbol as it is', () => {
    expect(withCurrencyCode('USD 12', undefined)).toBe('USD 12');
    expect(withCurrencyCode('12', 'EUR')).toBe('12');
  });
});
