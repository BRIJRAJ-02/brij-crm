import { describe, expect, it } from 'vitest';
import { emptyRecordsHref, usedByLine } from './impact-lines.ts';

const VIEW = '11111111-1111-4111-8111-111111111111';
const FORM = '22222222-2222-4222-8222-222222222222';
const ATTRIBUTE = '33333333-3333-4333-8333-333333333333';

describe('usedByLine', () => {
  it('names a grouped view and a form, and counts filters, sorts and rules', () => {
    expect(
      usedByLine({
        views: [
          { id: VIEW, name: 'Pipeline', uses: ['group'] },
          { id: VIEW, name: 'Hot', uses: ['filter', 'sort'] },
          { id: VIEW, name: 'Cold', uses: ['filter'] },
        ],
        forms: [{ id: FORM, name: 'Lead form' }],
        rules: 1,
      }),
    ).toBe('Used by: Pipeline (group by), 2 filters, 1 sort, Lead form, 1 rule');
  });

  it('says nothing when nothing uses it', () => {
    expect(usedByLine({ views: [], forms: [], rules: 0 })).toBeUndefined();
  });
});

describe('emptyRecordsHref', () => {
  it('opens the table with an "is empty" draft', () => {
    const href = emptyRecordsHref('/w/acme/objects/deals', ATTRIBUTE);
    expect(href.startsWith('/w/acme/objects/deals?draft=')).toBe(true);
    const text = href.slice(href.indexOf('=') + 1);
    expect(Buffer.from(text, 'base64url').toString('utf8')).toContain('is_empty');
  });
});
