// The write path's parse of a network's url attribute (polish item 8): a
// handle or a profile link is stored as the canonical link, and what the url
// field refuses is refused here with the same code and words. Pure: no database.
import { describe, expect, it } from 'vitest';
import { parseAttributeInput, type ParsedAttribute } from './parse-value.ts';

const attribute = (
  apiSlug: string,
  objectKey: string | null,
  isMulti = false,
  title = 'LinkedIn',
): ParsedAttribute => ({
  type: 'url',
  isMulti,
  apiSlug,
  objectKey,
  title,
});

describe('parseAttributeInput', () => {
  it('stores a handle or a profile link as the canonical profile link', () => {
    expect(parseAttributeInput(attribute('twitter', 'people', false, 'Twitter'), '@ada')).toEqual({
      ok: true,
      value: 'https://x.com/ada',
    });
    expect(
      parseAttributeInput(attribute('linkedin', 'people'), 'https://www.linkedin.com/in/ada/?utm_source=share'),
    ).toEqual({ ok: true, value: 'https://linkedin.com/in/ada' });
    expect(parseAttributeInput(attribute('linkedin', 'people'), 'ada')).toEqual({
      ok: true,
      value: 'https://linkedin.com/in/ada',
    });
  });

  it('takes a bare handle on Companies as the company page', () => {
    expect(parseAttributeInput(attribute('linkedin', 'companies'), 'acme')).toEqual({
      ok: true,
      value: 'https://linkedin.com/company/acme',
    });
    expect(parseAttributeInput(attribute('angellist', 'companies', false, 'AngelList'), 'acme')).toEqual({
      ok: true,
      value: 'https://wellfound.com/company/acme',
    });
  });

  it('checks each item of a list, and keeps an empty value empty', () => {
    expect(
      parseAttributeInput(attribute('github', null, true, 'GitHub'), ['octocat', 'https://github.com/ada/']),
    ).toEqual({ ok: true, value: ['https://github.com/octocat', 'https://github.com/ada'] });
    expect(parseAttributeInput(attribute('github', null), null)).toEqual({ ok: true, value: null });
  });

  it('refuses what the url field refuses, with the stable code and the same words', () => {
    expect(parseAttributeInput(attribute('linkedin', 'companies'), 'https://x.com/ada')).toEqual({
      ok: false,
      error: {
        code: 'ATTRIBUTE_VALUE_INVALID',
        message: 'That is a link to X. Enter a handle on LinkedIn, or a link to the profile.',
      },
    });
    expect(parseAttributeInput(attribute('twitter', 'people', false, 'Twitter'), 'ada lovelace')).toEqual({
      ok: false,
      error: {
        code: 'ATTRIBUTE_VALUE_INVALID',
        message: 'Enter a handle on Twitter, such as @adalovelace, or a link to the profile.',
      },
    });
    expect(parseAttributeInput(attribute('linkedin', null, true), ['ada', 'x y'])).toMatchObject({ ok: false });
    expect(parseAttributeInput(attribute('linkedin', null), 42)).toMatchObject({ ok: false });
  });

  it('leaves any other url attribute, and other types, to their schema', () => {
    expect(parseAttributeInput(attribute('website', 'companies'), 'ada')).toMatchObject({ ok: false });
    expect(parseAttributeInput(attribute('website', 'companies'), 'https://x.com/ada?s=1')).toEqual({
      ok: true,
      value: 'https://x.com/ada?s=1',
    });
    expect(parseAttributeInput({ ...attribute('linkedin', null), type: 'text' }, '@ada')).toEqual({
      ok: true,
      value: '@ada',
    });
  });
});
