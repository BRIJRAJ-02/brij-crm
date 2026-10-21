// The welcome page's suggestions (spec 0005, Value sourcing): a workspace
// name from your name, and a web address from the workspace name. Pure, so
// the rules are tested on their own.

/** A workspace's address: 3 to 40 lowercase letters and digits in single dash runs. The server checks the same rule. */
export const SLUG_RULE = /^(?=.{3,40}$)[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The longest address the server takes. */
export const SLUG_MAX = 40;

/** The first word of a name, or empty. */
export function firstWord(name: string): string {
  return name.trim().split(/\s+/)[0] ?? '';
}

/** "<first word>’s workspace" from your name, or empty while there is no name. */
export function suggestedWorkspaceName(yourName: string, possessive: (word: string) => string): string {
  const word = firstWord(yourName);
  return word === '' ? '' : possessive(word);
}

/**
 * A web address from a workspace name: accents dropped, apostrophes removed,
 * every other run of characters that aren't letters or digits turned into one
 * dash, lowercase, at most 40 characters, with no dash at either end.
 */
export function slugFrom(text: string): string {
  const plain = text
    .normalize('NFKD')
    .replaceAll(/\p{M}/gu, '')
    .toLowerCase()
    .replaceAll(/['’]/g, '')
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '');
  return plain.slice(0, SLUG_MAX).replace(/-+$/, '');
}

/** A web address as it is typed: lowercase, each run of spaces a dash, so a space never has to be refused. */
export function addressAsTyped(text: string): string {
  return text.toLowerCase().replaceAll(/\s+/g, '-');
}

/**
 * A name made from an email, for someone who gives none (spec 0036,
 * AC-1211): the part before the @ (and before any +tag), split at dots,
 * dashes and underscores, digits dropped, each word capitalised.
 * "ada.lovelace@acme.com" gives "Ada Lovelace". Empty when nothing is left.
 */
export function nameFromEmail(email: string): string {
  const local = (email.split('@')[0] ?? '').split('+')[0] ?? '';
  return local
    .split(/[._-]+/)
    .map((word) => word.replaceAll(/\d+/g, ''))
    .filter((word) => word !== '')
    .map((word) => `${word.charAt(0).toLocaleUpperCase()}${word.slice(1)}`)
    .join(' ')
    .slice(0, 80);
}

/**
 * The name a member is made with: the one typed, else the account's own (a
 * Google name), else one made from the email, else the email's first part,
 * so nobody is ever nameless.
 */
export function memberNameFor(typed: string, accountName: string, email: string): string {
  const candidates = [typed, accountName, nameFromEmail(email), email.split('@')[0] ?? '', email];
  return (candidates.map((candidate) => candidate.trim()).find((candidate) => candidate !== '') ?? email).slice(0, 80);
}

/** Email domains people sign up with for themselves, never a company's: no address is made from them. */
const PERSONAL_DOMAINS: ReadonlySet<string> = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'yahoo.com',
  'ymail.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'pm.me',
  'gmx.com',
  'gmx.net',
  'mail.com',
  'zoho.com',
  'yandex.com',
  'hey.com',
  'fastmail.com',
]);

/**
 * The company domain of an email ("ada@stealth.design" gives "stealth.design"),
 * or undefined for a personal mailbox (gmail.com, outlook.com and the like).
 */
export function companyDomain(email: string): string | undefined {
  const domain = (email.split('@')[1] ?? '').trim().toLowerCase();
  if (domain === '' || !domain.includes('.')) return undefined;
  const bare = domain.replace(/^www\./, '');
  return PERSONAL_DOMAINS.has(bare) || [...PERSONAL_DOMAINS].some((each) => bare.endsWith(`.${each}`))
    ? undefined
    : bare;
}

/** Endings that say nothing about a company, so "acme.com" never offers acme-com (stealth.design still offers stealth-design). */
const PLAIN_ENDINGS: ReadonlySet<string> = new Set([
  'com',
  'net',
  'org',
  'io',
  'co',
  'app',
  'ai',
  'dev',
  'uk',
  'us',
  'in',
]);

/** A workspace name without the "’s workspace" or " workspace" the suggested name ends with. */
function coreOf(name: string): string {
  return name
    .trim()
    .replace(/['’]s\s+workspace$/i, '')
    .replace(/\s+workspace$/i, '')
    .trim();
}

/**
 * Web addresses to offer for a workspace, best first (spec 0036): the name's
 * core ("Stealth’s workspace" gives stealth), then, for a company email, its
 * domain (stealth.design gives stealth and stealth-design; acme.com only
 * acme), then the whole
 * name, then the core with -team, -hq and -app. A number comes only after
 * all of those, as the last resort. Each follows the address rule; none
 * repeats.
 */
export function addressCandidates(name: string, email: string): readonly string[] {
  const core = slugFrom(coreOf(name));
  const domain = companyDomain(email);
  const label = domain === undefined ? '' : slugFrom(domain.split('.')[0] ?? '');
  const base = core !== '' ? core : label;
  const words = [
    core,
    label,
    domain === undefined || PLAIN_ENDINGS.has(domain.split('.').at(-1) ?? '') ? '' : slugFrom(domain),
    slugFrom(name),
    ...(base === '' ? [] : ['team', 'hq', 'app'].map((end) => `${base}-${end}`)),
    ...(base === '' ? [] : [2, 3, 4].map((count) => `${base}-${String(count)}`)),
  ];
  return [...new Set(words.filter((word) => SLUG_RULE.test(word)))];
}
