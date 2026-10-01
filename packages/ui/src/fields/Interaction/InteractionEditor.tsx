import { ReadOnlyValue } from '../parts.tsx';
import type { EditorProps } from '../types.ts';
import { InteractionDisplay } from './InteractionDisplay.tsx';

/** Interaction: the system records emails and meetings (#43, #44), so its editor shows it read only. */
export function InteractionEditor(props: EditorProps<'interaction'>) {
  return (
    <ReadOnlyValue attribute={props.attribute} surface={props.surface}>
      <InteractionDisplay
        attribute={props.attribute}
        value={props.value}
        surface={props.surface}
        {...(props.display === undefined ? {} : { display: props.display })}
      />
    </ReadOnlyValue>
  );
}
