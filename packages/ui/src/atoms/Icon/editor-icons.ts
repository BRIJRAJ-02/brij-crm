// The note editor's own icons (spec 0019): the format toolbar's marks, and
// the slash menu's headings, ordered list, quote and code block. Nothing
// outside the editor draws them, so they load with the editor's chunk rather
// than in the registry every page carries (10 icons, about 0.6 kB gzipped on
// every page). Like icons.ts, this file may import lucide-react; the editor
// draws them through Icon inside <IconScope icons={editorIcons}>.
import {
  Bold,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  Italic,
  ListOrdered,
  SquareCode,
  Strikethrough,
  TextQuote,
} from 'lucide-react';

/** The note editor's icons by their lucide.dev name; Icon draws them only inside an IconScope that holds this set. */
export const editorIcons = {
  bold: Bold,
  'heading-1': Heading1,
  'heading-2': Heading2,
  'heading-3': Heading3,
  highlighter: Highlighter,
  italic: Italic,
  'list-ordered': ListOrdered,
  'square-code': SquareCode,
  strikethrough: Strikethrough,
  'text-quote': TextQuote,
} as const;

/** An icon in the note editor's set. */
export type EditorIconName = keyof typeof editorIcons;
