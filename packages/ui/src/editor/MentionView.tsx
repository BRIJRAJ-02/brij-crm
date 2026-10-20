// A mention inside the editor, drawn as the library's Mention chip through a
// React node view, so a mention looks the same in a note as everywhere else.
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react';
import { createContext, useContext } from 'react';
import { Mention } from '../atoms/Mention/Mention.tsx';
import { strings } from './strings.ts';

/**
 * The screen's names for mentioned members, by id (RichTextEditor's
 * `mentionName`): a mention draws the member's name now, never the label a
 * stored document carries, which its writer could have set to anything.
 */
export const MentionNames = createContext<((id: string) => string | undefined) | undefined>(undefined);

/** The chip for one mention node: "@" and the member's name from the screen, else the stored label, else the id. */
function MentionChip({ node }: ReactNodeViewProps) {
  const nameOf = useContext(MentionNames);
  const label: unknown = node.attrs.label;
  const id: unknown = node.attrs.id;
  const stored = typeof label === 'string' && label !== '' ? label : typeof id === 'string' ? id : '';
  const name =
    nameOf === undefined
      ? stored
      : typeof id === 'string'
        ? (nameOf(id) ?? strings.formerMember)
        : strings.formerMember;
  return (
    <NodeViewWrapper as="span">
      <Mention>{`@${name}`}</Mention>
    </NodeViewWrapper>
  );
}

/** The node view the mention extension draws with. */
export const mentionView = ReactNodeViewRenderer(MentionChip, { as: 'span' });
