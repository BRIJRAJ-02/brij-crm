// Social profile links in the url field: the network logic lives in
// `@crm/contracts/values` (social.ts), shared with the engine's write path;
// this layer words its refusals in the field's copy and names the networks
// as their marks are labelled.
import {
  checkSocialProfile,
  checkWebLink,
  exampleHandle,
  type ProfileKind,
  type SocialNetwork,
} from '@crm/contracts/values';
import { strings as markStrings } from '../../atoms/ProviderMark/strings.ts';
import { strings } from './strings.ts';

/** The handle a network's field shows as its example ("@adalovelace"). */
export { exampleHandle };

export {
  describeLink,
  networkOfAttribute,
  profileKindOf,
  SOCIAL_NETWORKS,
  type LinkLabel,
  type ProfileKind,
  type SocialNetwork,
} from '@crm/contracts/values';

/** A network's name ("LinkedIn"), as its mark is labelled. */
export function networkName(network: SocialNetwork): string {
  return markStrings.names[network];
}

/** One checked value, or the sentence to show. */
export type Checked = { readonly ok: true; readonly value: string } | { readonly ok: false; readonly message: string };

/** A link typed by hand (a bare domain gets `https://`), or the sentence to show. */
export function checkLink(draft: string): Checked {
  const checked = checkWebLink(draft);
  if (checked.ok) return checked;
  return { ok: false, message: checked.reason === 'too_long' ? strings.tooLong : strings.invalidLink };
}

/** How a network's field names itself in its copy, and whose profiles it holds. */
export interface SocialContext {
  /** The attribute's name ("Twitter"), as its label reads, so the message matches the field. */
  readonly label: string;
  readonly kind: ProfileKind;
}

/** A network's handle or profile link as its one canonical link (`checkSocialProfile`), or the sentence to show. */
export function checkSocial(network: SocialNetwork, draft: string, context: SocialContext): Checked {
  const checked = checkSocialProfile(network, draft, context.kind);
  if (checked.ok) return checked;
  if (checked.reason === 'other_network') {
    return { ok: false, message: strings.otherNetwork(networkName(checked.network), context.label) };
  }
  return { ok: false, message: strings.invalidSocial(context.label, exampleHandle(network, context.kind)) };
}
