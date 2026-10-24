// SocialLinks' built in copy. Each network's name is the one `@crm/contracts` keeps (plain, with no Zod), so the
// editor, the server's refusals and the public row say the same name.
import { SOCIAL_LINK_NAMES } from '@crm/contracts/social-networks';

export type { SocialLinkNetwork } from '@crm/contracts/social-networks';

export const strings = {
  /** The list's default name for screen readers. */
  label: 'Social links',
  /** Each network's name as people say it. */
  names: SOCIAL_LINK_NAMES,
} as const;
