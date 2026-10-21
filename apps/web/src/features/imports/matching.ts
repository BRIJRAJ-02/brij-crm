// Matching a file's columns to an object's attributes (spec 0040, AC-1114,
// AC-1115, AC-1117). Pure: the screen hands in the attributes it loaded and a
// check that runs the field set's `fromText` over a sample.
import type { AttributeDefinition, ImportTarget, ObjectSummary } from '@crm/data';

/** Types an import never writes: the system sets them, or they need an upload. */
const NOT_IMPORTED: readonly string[] = ['timestamp', 'interaction', 'file'];

/** Types the engine finds records by (its unique keys). */
const MATCH_TYPES: readonly string[] = ['text', 'email', 'domain', 'url', 'phone', 'number'];

/** How many of a column's values the type check reads (AC-1114). */
export const SAMPLE_SIZE = 50;

/** One place a column can go: an attribute whole, or one part of a personal name. */
export interface ImportChoice {
  /** The Select's id: the attribute id, with `:first` or `:last` for a name part. */
  readonly id: string;
  readonly target: ImportTarget;
  readonly attribute: AttributeDefinition;
}

/** The Select id for a target. */
export const choiceId = (target: ImportTarget): string =>
  target.part === undefined ? target.attributeId : `${target.attributeId}:${target.part}`;

/**
 * The attributes a member may import into, in the object's order (AC-1115):
 * live, not system, not computed by the system, writable for them; a
 * personal name adds its First name and Last name parts. Relations come with
 * milestone 5.
 */
export function importChoices(attributes: readonly AttributeDefinition[]): readonly ImportChoice[] {
  return [...attributes]
    .filter(
      (attribute) =>
        !attribute.isSystem &&
        !attribute.isArchived &&
        attribute.readOnly === undefined &&
        attribute.type !== 'record_reference' &&
        !NOT_IMPORTED.includes(attribute.type),
    )
    .sort((a, b) => a.position - b.position)
    .flatMap((attribute) => {
      const whole: ImportChoice = { id: attribute.id, target: { attributeId: attribute.id }, attribute };
      if (attribute.type !== 'personal_name') return [whole];
      const part = (side: 'first' | 'last'): ImportChoice => ({
        id: `${attribute.id}:${side}`,
        target: { attributeId: attribute.id, part: side },
        attribute,
      });
      return [whole, part('first'), part('last')];
    });
}

/** A header or name as matching compares it: lower case, without spaces, dashes, underscores or dots. */
export const normalise = (text: string): string => text.toLowerCase().replace(/[\s\-_.]+/gu, '');

/** Other words a header may use for a standard attribute, by its API name (and name parts). */
const SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  name: ['fullname', 'contactname', 'personname', 'companyname', 'dealname'],
  'name:first': ['firstname', 'first', 'givenname', 'forename'],
  'name:last': ['lastname', 'last', 'surname', 'familyname'],
  email_addresses: ['email', 'emails', 'emailaddress', 'mail'],
  phone_numbers: ['phone', 'phones', 'phonenumber', 'telephone', 'tel', 'mobile'],
  domains: ['domain', 'website', 'web', 'site', 'url', 'companywebsite'],
  job_title: ['title', 'jobtitle', 'position', 'role'],
  description: ['about', 'notes', 'summary'],
  linkedin: ['linkedinurl', 'linkedinprofile'],
  twitter: ['x', 'twitterhandle'],
  value: ['amount', 'dealvalue'],
  stage: ['status', 'dealstage'],
};

/** The words a choice answers to: its name and API name (with the part), and their synonyms. */
function wordsOf(choice: ImportChoice): ReadonlySet<string> {
  const { attribute, target } = choice;
  const suffix = target.part === undefined ? '' : `:${target.part}`;
  const keys = [`${attribute.apiSlug}${suffix}`, `${normalise(attribute.title)}${suffix}`];
  const words =
    target.part === undefined
      ? [normalise(attribute.title), normalise(attribute.apiSlug)]
      : [`${normalise(attribute.title)}${target.part}`, `${target.part}${normalise(attribute.title)}`];
  return new Set([...words, ...keys.flatMap((key) => SYNONYMS[key] ?? [])]);
}

/** Whether most of a column's sampled values read as the choice's type: at least half of those not empty. */
export function samplesFit(samples: readonly string[], reads: (text: string) => boolean): boolean {
  const filled = samples.filter((sample) => sample.trim() !== '').slice(0, SAMPLE_SIZE);
  if (filled.length === 0) return true;
  return filled.filter(reads).length * 2 >= filled.length;
}

/**
 * Proposes where each column goes (AC-1114): its header against each
 * choice's words, then its sample through `reads` (the type's `fromText`);
 * a column whose values mostly don't read is left unmatched. One choice
 * takes one column, the first that names it; a whole name and its parts
 * never mix.
 */
export function autoMatch(
  headers: readonly string[],
  samples: readonly (readonly string[])[],
  choices: readonly ImportChoice[],
  reads: (choice: ImportChoice, text: string) => boolean,
): readonly (ImportTarget | undefined)[] {
  const words = choices.map((choice) => ({ choice, words: wordsOf(choice) }));
  const taken = new Set<string>();
  return headers.map((header, index) => {
    const key = normalise(header);
    if (key === '') return undefined;
    const found = words.find(
      ({ choice, words: each }) => each.has(key) && !clashes(choice.target, taken) && !taken.has(choice.id),
    );
    if (found === undefined) return undefined;
    if (!samplesFit(samples[index] ?? [], (text) => reads(found.choice, text))) return undefined;
    taken.add(found.choice.id);
    return found.choice.target;
  });
}

/** Whether a target can't sit beside those taken: a whole name beside one of its parts, or the reverse. */
function clashes(target: ImportTarget, taken: ReadonlySet<string>): boolean {
  if (target.part === undefined) {
    return taken.has(`${target.attributeId}:first`) || taken.has(`${target.attributeId}:last`);
  }
  return taken.has(target.attributeId);
}

/** Whether `target` may go to a column, given the others' targets (one attribute takes one column). */
export function isFree(target: ImportTarget, others: readonly (ImportTarget | undefined)[]): boolean {
  const taken = new Set(others.flatMap((each) => (each === undefined ? [] : [choiceId(each)])));
  return !taken.has(choiceId(target)) && !clashes(target, taken);
}

/**
 * The unique attributes rows may find their records by (AC-1117): the ones
 * a column is matched to whole, of a type the engine keys.
 */
export function matchAttributes(
  attributes: readonly AttributeDefinition[],
  targets: readonly (ImportTarget | undefined)[],
): readonly AttributeDefinition[] {
  const whole = new Set(
    targets.flatMap((target) => (target?.part === undefined && target ? [target.attributeId] : [])),
  );
  return attributes.filter(
    (attribute) => attribute.isUnique && MATCH_TYPES.includes(attribute.type) && whole.has(attribute.id),
  );
}

/** The attribute rows find their records by unless the member chooses: Email addresses on People, Domains on Companies. */
export function defaultMatch(
  object: Pick<ObjectSummary, 'standardKey'>,
  candidates: readonly AttributeDefinition[],
): string | undefined {
  const preferred =
    object.standardKey === 'people' ? 'email_addresses' : object.standardKey === 'companies' ? 'domains' : undefined;
  return candidates.find((attribute) => attribute.apiSlug === preferred)?.id;
}
