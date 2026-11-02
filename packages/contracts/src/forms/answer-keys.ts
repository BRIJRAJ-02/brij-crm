// The answer rules the hosted page runs itself (spec 0023): the longest answers, the honeypot's names and each
// choice's stable key. Plain TypeScript, no Zod. `answer-types.ts` re-exports all of it; the hosted page's own
// modules import it from here, so the builder's lists and words never ride in the page's first load (spec 0063).

/** The longest short text answer. */
export const SHORT_ANSWER_MAX = 200;

/** The longest long text answer. */
export const LONG_ANSWER_MAX = 2_000;

/** The honeypot's key in a submission's body: a person never fills it (spec 0023, bots and abuse). */
export const HONEYPOT_KEY = 'company_url';

/**
 * The honeypot input's `name` and the root of its `id` on every page we draw.
 * Never a word autofill knows (company, url, name, email...): Chrome ignores
 * `autocomplete="off"` on those and filled `company_url`, refusing real
 * bookings as bots (25 Oct 2026). The hyphen keeps it out of the question key
 * pattern, so it never meets a real question.
 */
export const HONEYPOT_INPUT_NAME = 'tf-trap';

/** What keeps password managers out of the honeypot: 1Password, LastPass, Bitwarden and Dashlane's own skip marks. */
export const HONEYPOT_IGNORE_ATTRIBUTES = {
  'data-1p-ignore': 'true',
  'data-lpignore': 'true',
  'data-bwignore': 'true',
  'data-form-type': 'other',
} as const;

/** A key not yet in `taken`: `key`, else `key_2`, `key_3`, … */
export function freeKey(key: string, taken: ReadonlySet<string>): string {
  if (!taken.has(key)) return key;
  const stem = key.replace(/_\d+$/, '').slice(0, 36);
  for (let n = 2; ; n += 1) {
    const next = `${stem}_${String(n)}`;
    if (!taken.has(next)) return next;
  }
}

/** A choice's key: lowercase, snake case, 1 to 40, a letter or digit first (an option value a site's own form posts). */
export const OPTION_KEY = /^[a-z0-9][a-z0-9_]{0,39}$/;

/** A choice key made from its words: `Under $5k` gives `under_5k`, `10 to 50` gives `10_to_50`, nothing gives `option`. */
export function optionKeyFromLabel(label: string): string {
  const key = label
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
    .replace(/_+$/g, '');
  return key === '' ? 'option' : key;
}

/**
 * Each choice's stable key, in the choices' order: the stored key where the
 * question has one, else one made from the choice's words, never two alike.
 * A question saved before keys existed reads the same keys every time, until
 * the builder stores them.
 */
export function choiceKeysOf(question: {
  readonly choices?: readonly string[] | undefined;
  readonly choiceKeys?: readonly string[] | undefined;
}): string[] {
  const choices = question.choices ?? [];
  const stored = question.choiceKeys ?? [];
  const taken = new Set<string>();
  return choices.map((label, index) => {
    const given = stored[index];
    const key =
      given !== undefined && OPTION_KEY.test(given) && !taken.has(given)
        ? given
        : freeKey(optionKeyFromLabel(label), taken);
    taken.add(key);
    return key;
  });
}
