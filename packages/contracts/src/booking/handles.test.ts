import { describe, expect, it } from 'vitest';
import { PublicBio, PublicHandle } from '../profile.ts';
import {
  bookingPagePath,
  handleAddressOf,
  handleFromName,
  handleProblem,
  HANDLE_PATTERN,
  isReservedHandle,
  profileSections,
  RESERVED_HANDLES,
} from './handles.ts';

describe('handles', () => {
  it.each([
    ['ada', undefined],
    ['ada-lovelace', undefined],
    ['a1b2c3', undefined],
    ['ab', 'Use at least 3 characters.'],
    ['a'.repeat(41), 'Use at most 40 characters.'],
    ['Ada', 'Use lowercase letters, numbers and single hyphens.'],
    ['ada--lovelace', 'Use lowercase letters, numbers and single hyphens.'],
    ['-ada', 'Use lowercase letters, numbers and single hyphens.'],
    ['ada_l', 'Use lowercase letters, numbers and single hyphens.'],
    ['settings', 'That handle is kept for Timefix. Pick another.'],
    ['sign-in', 'That handle is kept for Timefix. Pick another.'],
    ['api', 'That handle is kept for Timefix. Pick another.'],
  ])('%s: %s', (handle, problem) => {
    expect(handleProblem(handle)).toBe(problem);
  });

  it('keeps every path the app and the public pages use', () => {
    for (const word of [
      'api',
      'f',
      'b',
      'w',
      'embed',
      'assets',
      'sign-in',
      'join',
      'welcome',
      'status',
      'two-factor',
    ]) {
      expect(isReservedHandle(word)).toBe(true);
    }
    for (const word of [
      'verify',
      'email-preferences',
      'invite',
      'book',
      'form',
      'index',
      'settings',
      'admin',
      'help',
    ]) {
      expect(isReservedHandle(word)).toBe(true);
    }
    for (const word of ['app', 'www']) expect(isReservedHandle(word)).toBe(true);
    expect(new Set(RESERVED_HANDLES).size).toBe(RESERVED_HANDLES.length);
  });

  it('makes a handle from a name: lowercase, hyphens, 3 to 40, never reserved', () => {
    expect(handleFromName('Ada Lovelace')).toBe('ada-lovelace');
    expect(handleFromName('  Zoë  O’Brien ')).toBe('zoe-o-brien');
    expect(handleFromName('Al')).toBe('al-me');
    expect(handleFromName('')).toBe('me-me');
    expect(handleFromName('Settings')).toBe('settings-me');
    expect(handleFromName('x'.repeat(60))).toHaveLength(40);
    for (const name of ['Ada Lovelace', 'Al', '', 'Settings', '李']) {
      expect(handleProblem(handleFromName(name))).toBeUndefined();
    }
  });

  it('reads a handle address from a path, and nothing else', () => {
    expect(handleAddressOf('/ada')).toEqual({ kind: 'profile', handle: 'ada' });
    expect(handleAddressOf('/ada/')).toEqual({ kind: 'profile', handle: 'ada' });
    expect(handleAddressOf('/ada/30min')).toEqual({ kind: 'page', handle: 'ada', slug: '30min' });
    expect(handleAddressOf('/ada/30min/x')).toBeUndefined();
    expect(handleAddressOf('/b/AbCdEfGhIjKlMnOp')).toBeUndefined();
    expect(handleAddressOf('/settings')).toBeUndefined();
    expect(handleAddressOf('/ADA')).toBeUndefined();
    expect(handleAddressOf('/ada/Bad_Slug')).toBeUndefined();
  });

  it('builds a page’s path: the handle address once there is a handle, else /b/<key>', () => {
    expect(bookingPagePath({ handle: 'ada', slug: '30min', publicKey: 'AbCdEfGhIjKlMnOp' })).toBe('/ada/30min');
    expect(bookingPagePath({ slug: '30min', publicKey: 'AbCdEfGhIjKlMnOp' })).toBe('/b/AbCdEfGhIjKlMnOp');
    // A Link only page keeps its random key link.
    expect(bookingPagePath({ handle: 'ada', slug: '30min', publicKey: 'AbCdEfGhIjKlMnOp', isPrivate: true })).toBe(
      '/b/AbCdEfGhIjKlMnOp',
    );
  });

  it('parses a handle and a bio at the boundary', () => {
    expect(PublicHandle.parse(' Ada-Lovelace ')).toBe('ada-lovelace');
    expect(PublicHandle.safeParse('admin').success).toBe(false);
    expect(PublicBio.parse('  Product at Acme. ')).toBe('Product at Acme.');
    expect(PublicBio.safeParse('two\nlines').success).toBe(false);
    expect(PublicBio.safeParse('x'.repeat(161)).success).toBe(false);
    expect(HANDLE_PATTERN.test('ada')).toBe(true);
  });
});

describe('profileSections', () => {
  const page = (id: string, section?: string | null) => ({ id, section });

  it('groups items under their sections where each first appears, ignoring case and spaces, spelled as the first', () => {
    const sections = profileSections(
      [page('a'), page('b', 'Sales'), page('c', ' sales '), page('d', null), page('e', 'Support')],
      (item) => item.section,
    );
    expect(sections.map((each) => [each.key, each.title, each.items.map((item) => item.id)])).toEqual([
      ['', undefined, ['a', 'd']],
      ['sales', 'Sales', ['b', 'c']],
      ['support', 'Support', ['e']],
    ]);
  });

  it('reads a blank heading as none, and has no sections for no items', () => {
    expect(profileSections([page('a', '   ')], (item) => item.section)).toEqual([
      { key: '', items: [{ id: 'a', section: '   ' }] },
    ]);
    expect(profileSections([], () => undefined)).toEqual([]);
  });
});
