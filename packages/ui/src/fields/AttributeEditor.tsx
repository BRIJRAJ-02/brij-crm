// The only way anything edits an attribute value (AC-4): it hands the value to
// its type's one editor. Read only, computed and system values show read only;
// an AI value is edited as its result type, with Refresh beside it.
import type { AttributeType } from '@crm/contracts/values';
import { Button } from '../atoms/Button/Button.tsx';
import { AttributeDisplay } from './AttributeDisplay.tsx';
import styles from './AttributeEditor.module.css';
import { ReadOnlyValue } from './parts.tsx';
import { fieldTypeOf, readOnlyReasonOf } from './registry.ts';
import { strings } from './strings.ts';
import type { EditorProps } from './types.ts';

/** Props for AttributeEditor: any type's value and attribute, and where it commits. */
export type AttributeEditorProps = EditorProps<AttributeType> & {
  /** For an AI attribute that can refresh: asks the assistant to fill it again (#55). */
  readonly onRefresh?: () => void;
};

/**
 * Edits any attribute value through its type's one editor. What it commits
 * always parses with the type's schema (AC-5). A cell commits on Enter, a form
 * is always in edit mode, and a value people can't edit shows read only with
 * the reason.
 */
export function AttributeEditor({ onRefresh, ...props }: AttributeEditorProps) {
  const { attribute } = props;
  const reason = readOnlyReasonOf(attribute);
  if (reason !== undefined) {
    return (
      <ReadOnlyValue attribute={attribute} surface={props.surface} reason={reason}>
        <AttributeDisplay
          attribute={attribute}
          value={props.value}
          surface={props.surface}
          {...(props.display === undefined ? {} : { display: props.display })}
        />
      </ReadOnlyValue>
    );
  }
  const Editor = fieldTypeOf(attribute.type).Editor;
  if (attribute.ai?.canRefresh !== true || onRefresh === undefined) return <Editor {...props} />;
  return (
    <span className={styles.ai}>
      <Editor {...props} />
      <Button variant="ghost" icon="sparkles" onPress={onRefresh}>
        {strings.refresh}
      </Button>
    </span>
  );
}
