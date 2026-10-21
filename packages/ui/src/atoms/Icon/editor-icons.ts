// The note editor's own icons (spec 0019): the format toolbar's marks,
// headings, ordered list and quote. Nothing outside the editor draws them, so
// they load with the editor's chunk rather than in the registry every page
// carries (8 icons, about 0.5 kB gzipped on every page). Like icons.ts, this
// file may import lucide-react; the editor draws them through Icon inside
// <IconScope icons={editorIcons}>.
import { Bold, Heading1, Heading2, Highlighter, Italic, ListOrdered, Strikethrough, TextQuote } from 'lucide-react';

/** The note editor's icons by their lucide.dev name; Icon draws them only inside an IconScope that holds this set. */
export const editorIcons = {
  bold: Bold,
  'heading-1': Heading1,
  'heading-2': Heading2,
  highlighter: Highlighter,
  italic: Italic,
  'list-ordered': ListOrdered,
  strikethrough: Strikethrough,
  'text-quote': TextQuote,
} as const;

/** An icon in the note editor's set. */
export type EditorIconName = keyof typeof editorIcons;
