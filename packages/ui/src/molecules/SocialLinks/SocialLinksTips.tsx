// Brief
// Purpose: SocialLinks' tooltips ("LinkedIn · @ada"), loaded on demand so Tooltip stays out of a booking page's first load.
// Main task: hand SocialLinks a wrapper that puts each link in a Tooltip.
// Leaves out: the list and the links themselves (SocialLinks draws them).
import type { ReactElement } from 'react';
import { Tooltip } from '../../atoms/Tooltip/Tooltip.tsx';
import type { SocialLinkItem } from './SocialLinks.tsx';
import { socialLinkTip } from './SocialLinks.tsx';

/** How SocialLinks wraps each link. */
export type SocialLinkWrap = (link: SocialLinkItem, element: ReactElement) => ReactElement;

/** Props for SocialLinksTips. */
export interface SocialLinksTipsProps {
  /** SocialLinks' own list, drawn with the wrapper given. */
  readonly render: (wrap: SocialLinkWrap) => ReactElement;
}

/** SocialLinks with a tooltip on each link. SocialLinks loads it lazily. */
export function SocialLinksTips({ render }: SocialLinksTipsProps) {
  return render((link, element) => <Tooltip content={socialLinkTip(link)}>{element}</Tooltip>);
}
