// Reading an amount's text with the workspace's currency (Settings › Workspace › General): the attribute's own default
// wins, then the workspace's, and a symbol or code in the text beats both.
import { describe, expect, it } from 'vitest';
import { FIELD_SAMPLES } from '../../workbench/field-samples.ts';
import type { TextContext } from '../types.ts';
import { isRefusal } from '../values.ts';
import { currencyType } from './type.ts';

const base = FIELD_SAMPLES.currency.attribute;
const { defaultCurrency: _sample, ...withoutDefault } = base;
const contextOf = (over: Partial<TextContext> & { readonly own?: string } = {}): TextContext => {
  const { own, ...rest } = over;
  return {
    locale: 'en-US',
    timeZone: 'UTC',
    attribute: own === undefined ? withoutDefault : { ...withoutDefault, defaultCurrency: own },
    ...rest,
  };
};

describe('an amount read with the workspace’s currency', () => {
  it('takes a "$" as the workspace’s own dollar', () => {
    expect(currencyType.fromText('$1,200', contextOf({ defaultCurrency: 'AUD' }))).toEqual({
      amount: '1200',
      currency: 'AUD',
    });
  });

  it('reads a bare number in the workspace’s currency', () => {
    expect(currencyType.fromText('900', contextOf({ defaultCurrency: 'INR' }))).toEqual({
      amount: '900',
      currency: 'INR',
    });
  });

  it('lets the attribute’s own default win over the workspace’s', () => {
    expect(currencyType.fromText('900', contextOf({ own: 'EUR', defaultCurrency: 'INR' }))).toEqual({
      amount: '900',
      currency: 'EUR',
    });
  });

  it('lets a symbol that is not a dollar, or a code, name its own currency', () => {
    expect(currencyType.fromText('€900', contextOf({ defaultCurrency: 'AUD' }))).toEqual({
      amount: '900',
      currency: 'EUR',
    });
    expect(currencyType.fromText('900 GBP', contextOf({ defaultCurrency: 'AUD' }))).toEqual({
      amount: '900',
      currency: 'GBP',
    });
  });

  it('still asks for a code when nothing names one', () => {
    expect(isRefusal(currencyType.fromText('900', contextOf()))).toBe(true);
  });
});
