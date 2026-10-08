// The editor for link types that hold several values (emails, phones,
// domains, URLs): the values as removable chips, and a Field to add one more.
// Each change commits the whole list, checked with the attribute's schema.
import type { AttributeType } from '@crm/contracts/values';
import { useState, type ReactNode } from 'react';
import { Button } from '../atoms/Button/Button.tsx';
import { LinkChip } from '../atoms/LinkChip/LinkChip.tsx';
import { Field, type FieldProps } from '../molecules/Field/Field.tsx';
import { strings as fieldStrings } from '../molecules/Field/strings.ts';
import styles from './ListEditor.module.css';
import { strings } from './strings.ts';
import type { EditorProps } from './types.ts';
import { isCompactSurface, toCommittable } from './values.ts';

/** One checked value, or why the typed text isn't one. */
export type CheckedOne<V> = { readonly ok: true; readonly value: V } | { readonly ok: false; readonly message: string };

/** Props for ListEditor. */
export interface ListEditorProps<T extends AttributeType, V> extends EditorProps<T> {
  readonly values: readonly V[];
  readonly labelOf: (value: V) => string;
  readonly hrefOf: (value: V) => string;
  readonly checkOne: (draft: string) => CheckedOne<V>;
  readonly inputMode?: FieldProps['inputMode'];
  readonly type?: FieldProps['type'];
  readonly hint?: string;
  readonly prefix?: ReactNode;
}

/** Removable chips and an add Field; every change commits the whole list. */
export function ListEditor<T extends AttributeType, V>({
  attribute,
  surface,
  onCommit,
  onCancel,
  error,
  values,
  labelOf,
  hrefOf,
  checkOne,
  inputMode,
  type,
  hint,
  prefix,
  autoOpen = false,
  startText,
}: ListEditorProps<T, V>) {
  // Opened from a grid cell by typing: the add field starts with that key.
  const [draft, setDraft] = useState(startText ?? '');
  const [message, setMessage] = useState<string | undefined>(undefined);
  const commitList = (next: readonly V[]) => {
    const result = toCommittable<T>(attribute, next);
    if (!result.ok) {
      setMessage(result.message);
      return false;
    }
    setMessage(undefined);
    onCommit(result.value);
    return true;
  };
  const add = () => {
    if (draft.trim() === '') return;
    const one = checkOne(draft);
    if (!one.ok) {
      setMessage(one.message);
      return;
    }
    if (commitList([...values, one.value])) setDraft('');
  };
  const isCompact = isCompactSurface(surface);
  return (
    <div className={styles.root}>
      {values.length > 0 && (
        <ul className={styles.list} aria-label={attribute.name}>
          {values.map((value, index) => (
            <li key={`${String(index)}-${labelOf(value)}`} className={styles.item}>
              <LinkChip href={hrefOf(value)}>{labelOf(value)}</LinkChip>
              <Button
                variant="ghost"
                icon="x"
                label={strings.remove(labelOf(value))}
                onPress={() => {
                  commitList(values.filter((_, at) => at !== index));
                }}
              />
            </li>
          ))}
        </ul>
      )}
      <Field
        label={attribute.name}
        isLabelHidden={isCompact}
        size={isCompact ? 'sm' : 'md'}
        // The copy style's empty value, then an invitation to add one more.
        placeholder={values.length === 0 ? fieldStrings.setAttribute(attribute.name) : strings.addAnotherPlaceholder}
        value={draft}
        onChange={(next) => {
          setDraft(next);
          setMessage(undefined);
        }}
        onSubmit={add}
        onBlur={add}
        // Opened from a grid cell: keys go to the add field, never to a chip's link.
        // eslint-disable-next-line jsx-a11y-x/no-autofocus -- the editor was opened on purpose, from the cell
        autoFocus={autoOpen}
        {...(onCancel === undefined ? {} : { onEscape: onCancel })}
        {...((message ?? error) === undefined ? {} : { error: message ?? error })}
        {...(inputMode === undefined ? {} : { inputMode })}
        {...(type === undefined ? {} : { type })}
        {...(hint === undefined ? {} : { hint })}
        {...(prefix === undefined ? {} : { prefix })}
      />
    </div>
  );
}
