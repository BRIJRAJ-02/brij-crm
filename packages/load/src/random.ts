// A seeded random source (spec 0011, value sourcing: "drawn from a seeded
// random source, `--seed`"), so a run can be played again with the same
// arrivals, actions and choices. sfc32 on a 32 bit seed, split per user by a
// hash, so a user draws the same numbers in any thread.

/** Draws from one seeded stream. */
export interface Random {
  /** A number in [0, 1). */
  readonly next: () => number;
  /** An integer in [min, max). */
  readonly int: (min: number, max: number) => number;
  /** True with probability `p`. */
  readonly chance: (p: number) => boolean;
  /** One of `items` (which must not be empty). */
  readonly pick: <T>(items: readonly T[]) => T;
  /** An exponential gap with this mean: the time to the next arrival of a Poisson process. */
  readonly exponential: (mean: number) => number;
}

/** A 32 bit hash of a string or number (FNV 1a), for splitting one seed into many streams. */
export function hash32(value: string | number): number {
  let h = 0x811c9dc5;
  for (const char of String(value)) {
    h ^= char.charCodeAt(0);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A seeded stream: the same seed (and `stream`) always draws the same numbers. */
export function createRandom(seed: number, stream: string | number = 0): Random {
  let a = hash32(`a:${String(seed)}:${String(stream)}`);
  let b = hash32(`b:${String(seed)}:${String(stream)}`);
  let c = hash32(`c:${String(seed)}:${String(stream)}`);
  let d = 1;
  const next = (): number => {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  // Warm the state past the seeds' first draws.
  for (let i = 0; i < 12; i += 1) next();
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min)),
    chance: (p) => next() < p,
    pick: <T>(items: readonly T[]): T => {
      const item = items[Math.floor(next() * items.length)];
      if (item === undefined) throw new RangeError('Nothing to pick from.');
      return item;
    },
    // 1 - next() is in (0, 1], so the log is finite.
    exponential: (mean) => -Math.log(1 - next()) * mean,
  };
}
