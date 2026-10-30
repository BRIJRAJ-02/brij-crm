import { describe, expect, it } from 'vitest';
import { formatAggregate } from './calcs.ts';

describe('a footer calculation as words', () => {
  it('reads counts, capped counts and too many rows', () => {
    expect(formatAggregate({ count: 1204, atLeast: false }, 'count', 'en-US')).toBe('1,204');
    expect(formatAggregate({ count: 10000, atLeast: true }, 'count_empty', 'en-US')).toBe('10,000+');
    expect(formatAggregate({ tooMany: true }, 'sum', 'en-US')).toBe('over 10,000 rows');
  });

  it('reads amounts, a currency in its own format, and more than two currencies', () => {
    expect(formatAggregate({ amounts: [{ value: '42300' }] }, 'sum', 'en-US')).toBe('42,300');
    expect(formatAggregate({ amounts: [{ value: '42300', currency: 'USD' }] }, 'sum', 'en-US')).toBe('$42,300.00');
    expect(
      formatAggregate(
        {
          amounts: [
            { value: '10', currency: 'USD' },
            { value: '5', currency: 'EUR' },
            { value: '1', currency: 'GBP' },
          ],
        },
        'max',
        'en-US',
      ),
    ).toBe('$10.00 · €5.00 and 1 more');
    expect(formatAggregate({ amounts: [] }, 'avg', 'en-US')).toBe('—');
  });
});
