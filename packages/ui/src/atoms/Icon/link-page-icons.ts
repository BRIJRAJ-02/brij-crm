// The link page's own icons (spec 0051, the owner's design of 25 October 2026): Save contact's card and Share.
// Only LinkPage draws them, so they load with its chunk rather than in the registry every page carries. Like
// icons.ts, this file may import lucide-react; they are drawn through Icon inside <IconScope icons={linkPageIcons}>,
// which LinkPage wraps itself in.
import { ContactRound, Share2 } from 'lucide-react';

/** The link page's icons by their lucide.dev name; Icon draws them only inside an IconScope that holds this set. */
export const linkPageIcons = {
  'contact-round': ContactRound,
  'share-2': Share2,
} as const;

/** An icon in the link page's set. */
export type LinkPageIconName = keyof typeof linkPageIcons;
