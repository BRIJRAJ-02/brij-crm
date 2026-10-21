// A workspace's web address (spec 0036): its rule, the address made from a
// name, and the free ones to offer, best first. Pure, so the rules are tested
// on their own. Shared by first run's Your workspace and Settings › Workspace
// › General, so both suggest the same addresses.

/** A workspace's address: 3 to 40 lowercase letters and digits in single dash runs. The server checks the same rule. */
export const SLUG_RULE = /^(?=.{3,40}$)[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The longest address the server takes. */
export const SLUG_MAX = 40;

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
