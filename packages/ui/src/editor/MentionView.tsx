// A mention inside the editor, drawn as the library's Mention chip through a
// React node view, so a mention looks the same in a note as everywhere else.
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react';
import { Mention } from '../atoms/Mention/Mention.tsx';

/** The chip for one mention node: "@" and the member's name (or id, when no name was stored). */
function MentionChip({ node }: ReactNodeViewProps) {
  const label: unknown = node.attrs.label;
  const id: unknown = node.attrs.id;
  const name = typeof label === 'string' && label !== '' ? label : typeof id === 'string' ? id : '';
  return (
    <NodeViewWrapper as="span">
      <Mention>{`@${name}`}</Mention>
    </NodeViewWrapper>
  );
}

/** The node view the mention extension draws with. */
export const mentionView = ReactNodeViewRenderer(MentionChip, { as: 'span' });
