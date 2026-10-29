import { describe, expect, it } from 'vitest';
import { bootOf, readBoot } from './boot.ts';

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
    expect(bootOf(JSON.stringify({ kind: 'profile', profile }))).toEqual({ kind: 'profile', profile });
  });

  it('is nothing for no block, bad JSON or a partial answer, so the page loads as it always did', () => {
    expect(bootOf(undefined)).toBeUndefined();
    expect(bootOf(null)).toBeUndefined();
    expect(bootOf('{')).toBeUndefined();
    expect(bootOf('{"kind":"page","publicKey":"k1"}')).toBeUndefined();
    expect(bootOf(JSON.stringify({ kind: 'profile', profile: { ...profile, items: undefined } }))).toBeUndefined();
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
