// The API name "Add attribute" derives from a title (spec 0005, value
// sourcing): always a name the engine's slug rule accepts.
import { describe, expect, it } from 'vitest';
import { attributeSlugFrom } from './attributes.ts';

const ENGINE_SLUG = /^[a-z][a-z0-9_]{0,62}$/;

describe('attributeSlugFrom', () => {
  it.each([
    ['Job title', 'job_title'],
    ['  Lead   score! ', 'lead_score'],
    ['ARR (USD)', 'arr_usd'],
    ['Café owner', 'cafe_owner'],
    ['Lead-score', 'lead_score'],
    ['2026 goals', 'attribute_2026_goals'],
    ['!!!', 'attribute'],
    ['名前', 'attribute'],
  ])('%j gives %j', (title, slug) => {
    expect(attributeSlugFrom(title)).toBe(slug);
  });

  it('keeps to 63 characters with no trailing underscore', () => {
    const slug = attributeSlugFrom(`${'a'.repeat(62)} b`);
    expect(slug).toBe('a'.repeat(62));
    expect(attributeSlugFrom('x'.repeat(200))).toHaveLength(63);
  });

  it('always gives a name the engine accepts', () => {
    for (const title of ['A', '9', '_', 'é', 'Hello World 123', '9'.repeat(70), 'ß']) {
      expect(attributeSlugFrom(title), title).toMatch(ENGINE_SLUG);
    }
  });
});
