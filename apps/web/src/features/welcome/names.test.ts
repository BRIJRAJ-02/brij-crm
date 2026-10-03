// The welcome page's suggestions (spec 0005, Value sourcing): the workspace
// name from your first name, and the web address from the workspace name.
import { describe, expect, it } from 'vitest';
import { firstWord, SLUG_RULE, slugFrom, suggestedWorkspaceName } from './names.ts';
import { strings } from './strings.ts';

describe('the suggested workspace name', () => {
  it('is the first word of your name, then ’s workspace', () => {
    expect(suggestedWorkspaceName('Ada Lovelace', strings.possessive)).toBe('Ada’s workspace');
    expect(suggestedWorkspaceName('  Grace   Hopper ', strings.possessive)).toBe('Grace’s workspace');
  });

  it('is empty while there is no name', () => {
    expect(suggestedWorkspaceName('   ', strings.possessive)).toBe('');
    expect(firstWord('')).toBe('');
  });
});

describe('the web address', () => {
  it.each([
    ['Ada’s workspace', 'adas-workspace'],
    ["Ada's workspace", 'adas-workspace'],
    ['Halcyon Labs', 'halcyon-labs'],
    ['  Café  Zürich!! ', 'cafe-zurich'],
    ['ACME -- Corp', 'acme-corp'],
    ['2026 plans', '2026-plans'],
  ])('turns %j into %j', (name, slug) => {
    expect(slugFrom(name)).toBe(slug);
    expect(SLUG_RULE.test(slug)).toBe(true);
  });

  it('keeps to 40 characters with no dash at the end', () => {
    const slug = slugFrom('The extremely long name of a workspace that goes on and on');
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug.endsWith('-')).toBe(false);
    expect(SLUG_RULE.test(slug)).toBe(true);
  });

  it('can come out too short or empty, which the rule refuses', () => {
    expect(slugFrom('Al')).toBe('al');
    expect(SLUG_RULE.test('al')).toBe(false);
    expect(slugFrom('日本')).toBe('');
    expect(SLUG_RULE.test('')).toBe(false);
    expect(SLUG_RULE.test('two--dashes')).toBe(false);
    expect(SLUG_RULE.test('Upper')).toBe(false);
  });
});
