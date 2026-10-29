import { describe, expect, it } from 'vitest';
import { BOOT_PROFILE_FRESH_MS, bootOf, freshProfile, readBoot } from './boot.ts';

const profile = {
  handle: 'anish',
  name: 'Anish Rao',
  initials: 'AR',
  bio: '',
  items: [],
  theme: { ground: 'ink', hue: 'purple', mode: 'dark', shape: 'pill', fill: 'solid', font: 'mono' },
};

describe('bootOf', () => {
  it('reads a booking page’s key and address', () => {
    expect(bootOf('{"kind":"page","publicKey":"k1","handle":"anish","slug":"intro"}')).toEqual({
      kind: 'page',
      publicKey: 'k1',
      handle: 'anish',
      slug: 'intro',
    });
  });

  it('reads a profile with what the page draws first', () => {
    expect(bootOf(JSON.stringify({ kind: 'profile', profile, readAt: 5 }))).toEqual({
      kind: 'profile',
      profile,
      readAt: 5,
    });
  });

  it('is nothing for no block, bad JSON or a partial answer, so the page loads as it always did', () => {
    expect(bootOf(undefined)).toBeUndefined();
    expect(bootOf(null)).toBeUndefined();
    expect(bootOf('{')).toBeUndefined();
    expect(bootOf('{"kind":"page","publicKey":"k1"}')).toBeUndefined();
    expect(
      bootOf(JSON.stringify({ kind: 'profile', profile: { ...profile, items: undefined }, readAt: 5 })),
    ).toBeUndefined();
    expect(bootOf(JSON.stringify({ kind: 'profile', profile }))).toBeUndefined();
    expect(bootOf('{"kind":"other"}')).toBeUndefined();
  });
});

describe('readBoot', () => {
  it('reads the block by its id', () => {
    const json = '{"kind":"page","publicKey":"k1","handle":"a","slug":"b"}';
    const document = {
      getElementById: (id: string) => (id === 'crm-boot' ? ({ textContent: json } as HTMLElement) : null),
    };
    expect(readBoot(document)?.kind).toBe('page');
  });
});

describe('freshProfile', () => {
  const boot = { kind: 'profile', profile, readAt: 1_000_000 } as const;

  it('draws a copy read in the last few minutes', () => {
    expect(freshProfile(boot, 1_000_000 + 60_000)).toBe(profile);
  });

  it('never draws an old shell’s copy, which the page’s own read would repaint', () => {
    expect(freshProfile(boot, 1_000_000 + BOOT_PROFILE_FRESH_MS + 1)).toBeUndefined();
    expect(freshProfile(undefined, 0)).toBeUndefined();
    expect(freshProfile({ kind: 'page', publicKey: 'k', handle: 'a', slug: 'b' }, 0)).toBeUndefined();
  });
});
