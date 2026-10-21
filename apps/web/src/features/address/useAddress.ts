// A workspace's web address as it is set (spec 0036): the default made from
// the name (and a company email), checked through the one address check, and
// free suggestions when the typed address is taken or the default had to move.
import { useEffect, useRef, useState } from 'react';
import { SLUG_RULE } from './address.ts';

/** How long after the last key the address is checked (spec 0036, AC-1207). */
export const SLUG_CHECK_DELAY_MS = 300;

/** How many free suggestions show under the field. */
const SUGGESTIONS = 3;

/** The most checks one change of name or address spends finding free ones (the check allows 60 a minute). */
const MOST_CHECKS = 6;

/** Where the address stands: breaking the rule, being checked, or the check's answer (unknown: offline or limited). */
export type AddressState = 'invalid' | 'checking' | 'free' | 'taken' | 'unknown';

/** The address to use, where it stands, and free ones to offer instead. */
export interface Address {
  readonly slug: string;
  readonly state: AddressState;
  /** Free addresses to pick from: shown when the typed one is taken, or when the default isn't the first choice. */
  readonly suggestions: readonly string[];
}

interface Settled {
  readonly key: string;
  readonly slug: string;
  readonly state: 'free' | 'taken' | 'unknown';
  readonly suggestions: readonly string[];
}

/**
 * The address for a workspace being made: `typed` once the person types or
 * picks one, else the first free one of `candidates` (best first, from
 * `addressCandidates`). Each address is asked about once; an answer for an
 * older name or address is dropped.
 */
export function useAddress(
  check: (slug: string) => Promise<boolean>,
  candidates: readonly string[],
  typed: string | undefined,
): Address {
  const known = useRef(new Map<string, boolean>());
  const [settled, setSettled] = useState<Settled | undefined>(undefined);
  const key = typed === undefined ? `default:${candidates.join(',')}` : `typed:${typed}`;
  const first = candidates[0] ?? '';

  useEffect(() => {
    if (typed !== undefined && !SLUG_RULE.test(typed)) return;
    if (typed === undefined && candidates.length === 0) return;
    let isCurrent = true;
    let spent = 0;
    const ask = async (slug: string): Promise<boolean> => {
      const answer = known.current.get(slug);
      if (answer !== undefined) return answer;
      spent += 1;
      const free = await check(slug);
      known.current.set(slug, free);
      return free;
    };
    // Free ones from the candidates, in order, leaving out `skip`, until `want` are found or the checks run out.
    const freeOnes = async (want: number, skip: string): Promise<readonly string[]> => {
      const found: string[] = [];
      for (const candidate of candidates) {
        if (found.length >= want || spent >= MOST_CHECKS) break;
        if (candidate !== skip && (await ask(candidate))) found.push(candidate);
      }
      return found;
    };
    const settle = async (): Promise<Settled> => {
      if (typed !== undefined) {
        if (await ask(typed)) return { key, slug: typed, state: 'free', suggestions: [] };
        return { key, slug: typed, state: 'taken', suggestions: await freeOnes(SUGGESTIONS, typed) };
      }
      const free = await freeOnes(1, '');
      const chosen = free[0];
      if (chosen === undefined) return { key, slug: first, state: 'taken', suggestions: [] };
      if (chosen === first) return { key, slug: chosen, state: 'free', suggestions: [] };
      const more = await freeOnes(SUGGESTIONS, chosen);
      return { key, slug: chosen, state: 'free', suggestions: more.slice(0, SUGGESTIONS - 1) };
    };
    const run = () => {
      settle().then(
        (next) => {
          if (isCurrent) setSettled(next);
        },
        () => {
          if (isCurrent) setSettled({ key, slug: typed ?? first, state: 'unknown', suggestions: [] });
        },
      );
    };
    // Known answers settle at once (a picked suggestion was free a moment ago); new ones wait for typing to stop.
    const isKnown = typed === undefined ? known.current.has(first) : known.current.has(typed);
    const timer = isKnown ? undefined : setTimeout(run, SLUG_CHECK_DELAY_MS);
    if (isKnown) run();
    return () => {
      isCurrent = false;
      if (timer !== undefined) clearTimeout(timer);
    };
    // `key` carries `typed` and `candidates`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, check]);

  if (typed !== undefined && !SLUG_RULE.test(typed)) return { slug: typed, state: 'invalid', suggestions: [] };
  if (settled?.key === key) return settled;
  // While it is checked, the default keeps the last one found, so the field doesn't flick to a taken address.
  const holding = typed ?? (settled?.key.startsWith('default:') === true ? settled.slug : first);
  return { slug: holding, state: typed === undefined && first === '' ? 'invalid' : 'checking', suggestions: [] };
}
