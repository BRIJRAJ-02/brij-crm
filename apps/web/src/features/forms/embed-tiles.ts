// The three ways a site shows an embed, as tiles picked by sight (spec 0058, AC-11): one list for every card that
// offers them, a form's Share tab and a booking page's Put it on your site, so the two never drift apart in name,
// mark or line (5 November 2026: the same card for both).
import type { ChoiceTile } from '@crm/ui';
import type { EmbedMode } from './snippets.ts';
import { strings } from './strings.ts';

/**
 * The three ways, in `EMBED_MODES` order: each a small picture, a name, and a line saying what the visitor sees.
 * The pictures are marks the icon registry already holds (each new mark costs every page's first load).
 */
export const EMBED_TILES: readonly (ChoiceTile & { readonly id: EmbedMode })[] = [
  { id: 'inline', name: strings.embedInline, icon: 'file-text', description: strings.embedInlineHint },
  { id: 'popup', name: strings.embedPopup, icon: 'layers', description: strings.embedPopupHint },
  { id: 'floating', name: strings.embedFloating, icon: 'message-square', description: strings.embedFloatingHint },
];
