// The one place a caller's input becomes an attribute's canonical value
// (record writes and bulk edits through `parseFor`, imports, forms): the
// type's schema, plus, for a url attribute whose API name names a network
// (`linkedin`, `twitter`), the profile check the url field runs, so a handle
// or any profile link is stored as the profile's one canonical link and a
// handle the field refuses is refused here in the same way.
import {
  ATTRIBUTE_VALUE_INVALID,
  checkSocialProfile,
  exampleHandle,
  networkOfAttribute,
  parseAttributeValue,
  profileKindOf,
  type AttributeType,
  type AttributeValueResult,
  type SocialNetwork,
} from '@crm/contracts/values';

/** What the parser reads of an attribute: its type, whether it holds a list, and for a url its API name and object. */
export interface ParsedAttribute {
  readonly type: AttributeType;
  readonly isMulti: boolean;
  readonly apiSlug: string;
  /** The attribute's object's standard key, else its API name (`companies`); null on a list's own attribute. */
  readonly objectKey: string | null;
  readonly title: string;
}

/** Each network as a refusal names it. */
const NETWORK_NAMES: { readonly [N in SocialNetwork]: string } = {
  linkedin: 'LinkedIn',
  x: 'X',
  instagram: 'Instagram',
  github: 'GitHub',
  facebook: 'Facebook',
  youtube: 'YouTube',
  angellist: 'AngelList',
  tiktok: 'TikTok',
  threads: 'Threads',
};

/** The words of a refused profile, as the url field words them. */
export const SOCIAL_WORDS = {
  invalid: (title: string, example: string) =>
    `Enter a handle on ${title}, such as ${example}, or a link to the profile.`,
  otherNetwork: (network: SocialNetwork, title: string) =>
    `That is a link to ${NETWORK_NAMES[network]}. Enter a handle on ${title}, or a link to the profile.`,
} as const;

type Item = { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly message: string };

/** One item through the network's check; anything but text is left for the schema to refuse. */
function socialItem(attribute: ParsedAttribute, network: SocialNetwork, item: unknown): Item {
  if (typeof item !== 'string') return { ok: true, value: item };
  const kind = profileKindOf(attribute);
  const checked = checkSocialProfile(network, item, kind);
  if (checked.ok) return checked;
  return {
    ok: false,
    message:
      checked.reason === 'other_network'
        ? SOCIAL_WORDS.otherNetwork(checked.network, attribute.title)
        : SOCIAL_WORDS.invalid(attribute.title, exampleHandle(network, kind)),
  };
}

/**
 * Parses an input into the attribute's canonical value, or refuses it with
 * `ATTRIBUTE_VALUE_INVALID` and how to fix it. A network's url attribute
 * takes a handle (`@ada`) or a profile link and keeps the canonical link.
 */
export function parseAttributeInput(attribute: ParsedAttribute, input: unknown): AttributeValueResult {
  const network = attribute.type === 'url' ? networkOfAttribute(attribute) : undefined;
  const options = { allowMultiple: attribute.isMulti };
  if (network === undefined || input === null || input === undefined) {
    return parseAttributeValue(attribute.type, input, options);
  }
  const items = Array.isArray(input) ? (input as readonly unknown[]) : [input];
  const values: unknown[] = [];
  for (const item of items) {
    const checked = socialItem(attribute, network, item);
    if (!checked.ok) return { ok: false, error: { code: ATTRIBUTE_VALUE_INVALID, message: checked.message } };
    values.push(checked.value);
  }
  return parseAttributeValue(attribute.type, Array.isArray(input) ? values : values[0], options);
}
