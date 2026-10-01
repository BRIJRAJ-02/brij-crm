import { ReadOnlyValue } from '../parts.tsx';
import type { EditorProps } from '../types.ts';
import { TimestampDisplay } from './TimestampDisplay.tsx';

/** Timestamp: the system writes it, so its editor shows it read only. */
export function TimestampEditor(props: EditorProps<'timestamp'>) {
  return (
    <ReadOnlyValue attribute={props.attribute} surface={props.surface}>
      <TimestampDisplay attribute={props.attribute} value={props.value} surface={props.surface} />
    </ReadOnlyValue>
  );
}
