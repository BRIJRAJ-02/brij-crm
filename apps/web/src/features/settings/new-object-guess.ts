// What the New object dialog guesses from what is typed: the plural of a name, an icon and a colour for it, the
// type of an attribute from its name, and the starter attributes a common object suggests. Pure; the person can
// change every guess, and a guess never overwrites what they chose.
import type { Hue, ObjectIcon, PickerAttributeType } from '@crm/data';

/** The plural of an English name: "Company" is "Companies", "Box" is "Boxes", "Project" is "Projects". */
export function pluralOf(singular: string): string {
  const name = singular.trim();
  if (name === '') return '';
  if (SAME_BOTH.test(lastWord(name).toLowerCase())) return name;
  const lower = name.toLowerCase();
  const end = lower.slice(-1);
  // An acronym takes a small s, "APIs" as "KPIs" is read back as a plural; a capitals word takes capitals.
  if (/^[A-Z]{2,}$/.test(lastWord(name)) && !/\s/.test(name)) return `${name}s`;
  const keepsCase = name === name.toUpperCase() && name.length > 1;
  const add = (suffix: string) => (keepsCase ? suffix.toUpperCase() : suffix);
  if (/(s|x|z|ch|sh)$/.test(lower)) return `${name}${add('es')}`;
  if (end === 'y' && !/[aeiou]y$/.test(lower)) return `${name.slice(0, -1)}${add('ies')}`;
  return `${name}${add('s')}`;
}

/**
 * Whether a name reads as a plural already ("Projects", "Graphic Designers"): its last word ends in an s that isn't
 * a singular's own (Address, Status, Analysis). The New object dialog's Name was always taken as the singular, so
 * "Projects" became the object "Projectses", whose API name can't change afterwards (crm-f7, 28 Oct 2026).
 */
export function looksPlural(name: string): boolean {
  const word = lastWord(name);
  // Capitals and a small s are an acronym's plural ("KPIs", "APIs"), whatever letter comes before the s.
  if (/^[A-Z]{2,}s$/.test(word)) return true;
  const last = word.toLowerCase();
  if (SAME_BOTH.test(last)) return false;
  // Plurals in -us and -is a CRM may be named ("Menus", "Emojis"): missed, "Menus" became "Menuses", an API name
  // fixed for good; a singular wrongly taken for a plural only guesses a singular that can be renamed later.
  if (US_IS_PLURALS.test(last)) return true;
  return last.length > 2 && last.endsWith('s') && !/(ss|us|is)$/.test(last);
}

/** A name's last word, as typed. */
function lastWord(name: string): string {
  return name.trim().split(/\s+/).at(-1) ?? '';
}

/** Words the same in the singular and the plural ("Series", "News", "Analytics", "Lens"): neither guess changes them. */
const SAME_BOTH =
  /^(series|species|news|analytics|logistics|economics|ethics|physics|mathematics|politics|lens|canvas|atlas|gas|alias|bias|saas|ios)$/;

/** Plurals ending -us or -is, where most words so ending are singulars (Status, Analysis). */
const US_IS_PLURALS = /^(menus|gurus|emus|haikus|emojis|wikis|taxis|skis|kiwis)$/;

/** Singulars that end in -ie, whose plural ends -ies like Company's: "Movies" is "Movie", not "Movy". */
const IE_SINGULARS = /\b(movie|cookie|calorie|rookie|selfie|zombie|freebie|pie|tie)s$/;

/** Singulars in -us, whose plural adds -es ("Statuses"): every other -uses is a word in -use plus s ("Houses"). */
const US_SINGULARS = /\b(status|campus|bonus|virus|census|focus|syllabus|corpus|bus)es$/;

/**
 * The singular of a plural name, a guess the person can correct: "Companies" is "Company", "Boxes" "Box",
 * "Addresses" "Address", "Statuses" "Status", "Cases" "Case", "Houses" "House", "Graphic Designers" "Graphic Designer". Only the last
 * word changes. A name that doesn't look plural comes back as it is.
 */
export function singularOf(name: string): string {
  const trimmed = name.trim();
  if (!looksPlural(trimmed)) return trimmed;
  if (US_IS_PLURALS.test(lastWord(trimmed).toLowerCase())) return trimmed.slice(0, -1);
  // Anchored to the last word: "Opportunities" must not read as "-ties" from "tie".
  const lower = lastWord(trimmed).toLowerCase();
  if (IE_SINGULARS.test(lower)) return trimmed.slice(0, -1);
  if (lower.endsWith('ies')) return `${trimmed.slice(0, -3)}${trimmed.slice(-3) === 'IES' ? 'Y' : 'y'}`;
  // -es after ss, x, z, ch or sh is the plural's own ("Addresses", "Boxes", "Matches"), and after a known -us singular
  // ("Statuses"); after anything else the e is the word's ("Cases", "Houses", "Licenses"), so only the s goes.
  if (/(ss|x|z|ch|sh)es$/.test(lower) || US_SINGULARS.test(lower)) return trimmed.slice(0, -2);
  return trimmed.slice(0, -1);
}

/**
 * The singular and plural a typed name gives: a plural ("Projects") is taken as the plural, its singular guessed;
 * anything else is the singular, its plural guessed.
 */
export function namesFrom(typed: string): { readonly singular: string; readonly plural: string } {
  const name = typed.trim();
  return looksPlural(name) ? { singular: singularOf(name), plural: name } : { singular: name, plural: pluralOf(name) };
}

/** Words in an object's name, and the icon each suggests (curated `ObjectIcon`s only). */
const ICON_WORDS: readonly (readonly [RegExp, ObjectIcon])[] = [
  [/\b(project|initiative|program)/, 'folder'],
  [/\b(partner|vendor|supplier|agenc)/, 'handshake'],
  [/\b(invoice|bill|payment|expense|receipt)/, 'receipt'],
  [/\b(subscription|plan|pricing|product|item|inventory|order)/, 'package'],
  [/\b(ticket|case|issue|request|support)/, 'ticket'],
  [/\b(event|meeting|appointment|booking|webinar)/, 'calendar'],
  [/\b(candidate|applicant|job|hire|recruit)/, 'briefcase'],
  [/\b(student|course|class|lesson|school)/, 'graduation-cap'],
  [/\b(property|listing|house|home|apartment|building|office)/, 'house'],
  [/\b(vehicle|car|fleet|driver)/, 'car'],
  [/\b(trip|travel|flight|shipment)/, 'plane'],
  [/\b(contract|document|proposal|quote|file)/, 'file-text'],
  [/\b(campaign|lead|marketing|promo)/, 'megaphone'],
  [/\b(task|todo|checklist)/, 'list-checks'],
  [/\b(bug|defect)/, 'bug'],
  [/\b(patient|clinic|health|doctor)/, 'stethoscope'],
  [/\b(donor|donation|grant|fund)/, 'heart'],
  [/\b(asset|equipment|device|laptop)/, 'laptop'],
  [/\b(store|shop|location|branch|restaurant)/, 'store'],
  [/\b(idea|feature|feedback)/, 'lightbulb'],
  [/\b(deal|opportunit|sale)/, 'chart-line'],
  [/\b(person|people|contact|customer|member|client|user|team)/, 'user'],
  [/\b(compan|organi[sz]ation|account|business)/, 'building'],
];

/** The icon a name suggests, or the plain box when no word matches. */
export function iconFor(name: string): ObjectIcon {
  const lower = name.toLowerCase();
  return ICON_WORDS.find(([pattern]) => pattern.test(lower))?.[1] ?? 'box';
}

/** The first of `hues` no one uses, starting from a position the name picks, so "Projects" and "Partners" differ. */
export function hueFor(name: string, hues: readonly Hue[], taken: readonly Hue[]): Hue {
  const start = Array.from(name.trim().toLowerCase()).reduce((sum, letter) => sum + letter.charCodeAt(0), 0);
  const colours = hues.filter((hue) => hue !== 'gray');
  const free = colours.filter((hue) => !taken.includes(hue));
  const pool = free.length > 0 ? free : colours;
  return pool[start % pool.length] ?? 'gray';
}

/** Types an inline row offers: the ones that need nothing more to be useful (a select waits for its options on the Attributes tab). */
export const INLINE_TYPES = [
  'text',
  'long_text',
  'number',
  'currency',
  'date',
  'checkbox',
  'rating',
  'email',
  'phone',
  'url',
  'location',
] as const satisfies readonly PickerAttributeType[];

/** An attribute type an inline row offers. */
export type InlineType = (typeof INLINE_TYPES)[number];

/** Words in an attribute's name, and the type each suggests; the first match wins. */
const TYPE_WORDS: readonly (readonly [RegExp, InlineType])[] = [
  [/\be-?mail/, 'email'],
  [/\b(phone|mobile|cell|fax|whatsapp)/, 'phone'],
  [/\b(website|url|link|linkedin|twitter|domain|site|web)\b/, 'url'],
  [/\b(amount|price|cost|fee|revenue|budget|salary|value|total|balance|spend|mrr|arr)\b/, 'currency'],
  [/\b(quantity|qty|count|number|age|hours|score|units|size|weight|seats)\b/, 'number'],
  [/\b(date|deadline|due|birthday|birth|start|end|created|renewal|expires|expiry|closed)\b/, 'date'],
  [/\b(address|city|country|location|region|state)\b/, 'location'],
  [/\b(rating|stars)\b/, 'rating'],
  [/^(is|has|can|active|paid|done|verified|approved)\b|\?$/, 'checkbox'],
  [/\b(notes?|description|details|summary|comments?|bio|about|message|body)\b/, 'long_text'],
];

/** The type a name suggests ("Email" is email, "Due date" is date), plain text when none does. */
export function typeFor(name: string): InlineType {
  const lower = name.trim().toLowerCase();
  return TYPE_WORDS.find(([pattern]) => pattern.test(lower))?.[1] ?? 'text';
}

/** One starter attribute suggestion. */
export interface Starter {
  readonly title: string;
  readonly type: InlineType;
}

/** Starter attributes for objects people commonly make, by a word in the name. */
const STARTERS: readonly (readonly [RegExp, readonly string[]])[] = [
  [/project|initiative/, ['Status', 'Owner', 'Start date', 'Due date', 'Budget', 'Description']],
  [/partner|vendor|supplier/, ['Website', 'Email', 'Phone', 'Contract value', 'Renewal date']],
  [/invoice|bill|expense/, ['Amount', 'Issue date', 'Due date', 'Paid', 'Notes']],
  [/ticket|case|issue|request/, ['Subject', 'Description', 'Priority', 'Opened date']],
  [/event|meeting|webinar/, ['Date', 'Location', 'Capacity', 'Notes']],
  [/candidate|applicant/, ['Email', 'Phone', 'LinkedIn', 'Applied date', 'Notes']],
  [/product|item/, ['Price', 'Quantity', 'Description', 'Website']],
  [/property|listing/, ['Address', 'Price', 'Bedrooms', 'Listed date']],
  [/vehicle|car/, ['Price', 'Year', 'Purchase date', 'Notes']],
  [/contract|proposal|quote/, ['Amount', 'Start date', 'End date', 'Notes']],
  [/student|patient|donor/, ['Email', 'Phone', 'Start date', 'Notes']],
];

/** What an object with no match suggests. */
const GENERIC_STARTERS: readonly string[] = ['Description', 'Owner email', 'Website', 'Due date'];

/** The starter attributes a name suggests, typed by `typeFor`; fewer than the generic ones are never mixed in. */
export function startersFor(name: string): readonly Starter[] {
  const lower = name.trim().toLowerCase();
  if (lower === '') return [];
  const titles = STARTERS.find(([pattern]) => pattern.test(lower))?.[1] ?? GENERIC_STARTERS;
  return titles.map((title) => ({ title: title === 'Status' ? 'Stage' : title, type: typeFor(title) }));
}
