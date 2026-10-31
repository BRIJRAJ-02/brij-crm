// The library never imports `@crm/contracts`, so spec 0061's closed sets and their words are repeated here: the
// media providers and their names, the notices and their sentences, and the tile sizes. This test reads the
// contracts' source as text and fails when the two drift apart, so a provider or notice added there draws here too.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { strings } from './strings.ts';

const RULES = readFileSync(new URL('../../../../contracts/src/booking/link-page-rules.ts', import.meta.url), 'utf8');
const MODULE = readFileSync(new URL('./LinkPage.tsx', import.meta.url), 'utf8');

/** The words of one closed set, as `link-page-rules.ts` lists them. */
function setOf(name: string): readonly string[] {
  const found = new RegExp(`export const ${name} = \\[([^\\]]*)\\]`).exec(RULES);
  expect(found, `${name} is declared in the contracts`).not.toBeNull();
  return [...(found?.[1] ?? '').matchAll(/'([a-z0-9]+)'/g)].map((match) => match[1] ?? '');
}

/** The words one of this module's types allows, as `LinkPage.tsx` writes it. */
function typeOf(name: string): readonly string[] {
  const body = new RegExp(`export type ${name} = ([^;]*);`).exec(MODULE)?.[1] ?? '';
  return [...body.matchAll(/'([a-z0-9]+)'/g)].map((match) => match[1] ?? '');
}

describe('spec 0061’s sets, as the contracts write them', () => {
  it('names the same media providers, with the same names', () => {
    expect(typeOf('LinkPageMediaProvider')).toEqual(setOf('MEDIA_PROVIDERS'));
    for (const [provider, name] of Object.entries(strings.providers)) {
      expect(RULES).toContain(`${provider}: '${name}'`);
    }
  });

  it('asks the same notices, in the same words', () => {
    expect(typeOf('LinkPageNotice')).toEqual(setOf('PROFILE_NOTICES'));
    expect(strings.notices.sensitive).toBe('This link may show sensitive content.');
    expect(RULES).toContain(`'${strings.notices.sensitive}'`);
    for (const age of ['18', '21'] as const) {
      expect(RULES).toContain('return `You need to be ${notice} or older to open this.`;');
      expect(strings.notices[age]).toBe(`You need to be ${age} or older to open this.`);
    }
  });

  it('sizes tiles by the same three words', () => {
    expect(typeOf('LinkPageTileSize')).toEqual(setOf('PROFILE_TILE_SIZES'));
  });
});
