// The editor for link types that hold several values (emails, phones,
// domains, URLs): the values as removable chips, and a Field to add one more.
// Each change commits the whole list, checked with the attribute's schema.
import type { AttributeType } from '@crm/contracts/values';
import { useState, type ReactNode } from 'react';
import { Button } from '../atoms/Button/Button.tsx';
import { LinkChip } from '../atoms/LinkChip/LinkChip.tsx';
import type { ProviderName } from '../atoms/ProviderMark/ProviderMark.tsx';
import { Field, type FieldProps } from '../molecules/Field/Field.tsx';
import { FieldGroup } from '../molecules/FieldGroup/FieldGroup.tsx';
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
  /** The type's example for the add field while the list is empty, on a form or a preview (as TextLikeEditor's). */
  readonly placeholder?: string;
  /** A brand mark to lead a value's chip: a social profile's network. */
  readonly markOf?: (value: V) => ProviderName | undefined;
  readonly prefix?: ReactNode;
  /**
   * Draws the add field itself, from the props the Field would take: a type
   * whose one field is more than a Field (a phone number's PhoneField, with
   * its country code) draws that, so adding one more reads like editing one.
   */
  readonly renderAdd?: (field: AddFieldProps) => ReactNode;
}

/** What ListEditor's add field takes, handed to `renderAdd`. */
export interface AddFieldProps {
  readonly label: string;
  readonly isLabelHidden: boolean;
  readonly size: 'md' | 'sm';
  readonly placeholder: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** Adds what is typed: Enter, or focus leaving. */
  readonly onAdd: () => void;
  readonly onEscape?: () => void;
  readonly error?: string;
  readonly autoFocus: boolean;
  /** The form around it is sending: the field takes nothing until the answer. */
  readonly isDisabled: boolean;
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
  placeholder,
  markOf,
  prefix,
  renderAdd,
  autoOpen = false,
  startText,
  isDisabled = false,
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
    // At the list's limit, one more is refused here, and what was typed stays to move or fix.
    if (attribute.limit !== undefined && values.length >= attribute.limit.count) {
      setMessage(attribute.limit.message);
      return;
    }
    const one = checkOne(draft);
    if (!one.ok) {
      setMessage(one.message);
      return;
    }
    if (commitList([...values, one.value])) setDraft('');
  };
  const isCompact = isCompactSurface(surface);
  const chipExtras = (value: V) => {
    const mark = markOf?.(value);
    return mark === undefined ? {} : { mark };
  };
  const emptyPlaceholder =
    isCompact || placeholder === undefined ? fieldStrings.setAttribute(attribute.name) : placeholder;
  // On a form the name leads, over the chips, as FieldGroup labels what a form shows (as every field's label sits over
  // its value); the add field under them keeps the name for screen readers. A cell or a panel row names it already.
  const isLabelledAbove = !isCompact && values.length > 0;
  const chips = values.length > 0 && (
    <ul className={styles.list} aria-label={attribute.name}>
      {values.map((value, index) => (
        <li key={`${String(index)}-${labelOf(value)}`} className={styles.item}>
          <LinkChip href={hrefOf(value)} {...chipExtras(value)}>
            {labelOf(value)}
          </LinkChip>
          <Button
            variant="ghost"
            icon="x"
            label={strings.remove(labelOf(value))}
            isDisabled={isDisabled}
            onPress={() => {
              commitList(values.filter((_, at) => at !== index));
            }}
          />
        </li>
      ))}
    </ul>
  );
  return (
    <div className={styles.root}>
      {isLabelledAbove ? <FieldGroup label={attribute.name}>{chips}</FieldGroup> : chips}
      {renderAdd === undefined ? (
        <Field
          label={attribute.name}
          isLabelHidden={isCompact || isLabelledAbove}
          size={isCompact ? 'sm' : 'md'}
          // The copy style's empty value, then an invitation to add one more.
          placeholder={values.length === 0 ? emptyPlaceholder : strings.addAnotherPlaceholder}
          value={draft}
          onChange={(next) => {
            setDraft(next);
            setMessage(undefined);
          }}
          onSubmit={add}
          // Enter with an address typed adds it, and only that: in a form (a create dialog, New meeting) it must not
          // also submit the form around it. An empty add field lets Enter through, so the form still submits.
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing && draft.trim() !== '') event.preventDefault();
          }}
          // A record's value, never the viewer's own: no browser autofill, and no password manager taking it for a login.
          autoComplete="off"
          onBlur={add}
          // Opened from a grid cell: keys go to the add field, never to a chip's link.
          // eslint-disable-next-line jsx-a11y-x/no-autofocus -- the editor was opened on purpose, from the cell
          autoFocus={autoOpen}
          isDisabled={isDisabled}
          {...(onCancel === undefined ? {} : { onEscape: onCancel })}
          {...((message ?? error) === undefined ? {} : { error: message ?? error })}
          {...(inputMode === undefined ? {} : { inputMode })}
          {...(type === undefined ? {} : { type })}
          {...(hint === undefined ? {} : { hint })}
          {...(prefix === undefined ? {} : { prefix })}
        />
      ) : (
        renderAdd({
          label: attribute.name,
          isLabelHidden: isCompact || isLabelledAbove,
          size: isCompact ? 'sm' : 'md',
          placeholder: values.length === 0 ? emptyPlaceholder : strings.addAnotherPlaceholder,
          value: draft,
          onChange: (next) => {
            setDraft(next);
            setMessage(undefined);
          },
          onAdd: add,
          autoFocus: autoOpen,
          isDisabled,
          ...(onCancel === undefined ? {} : { onEscape: onCancel }),
          ...((message ?? error) === undefined ? {} : { error: message ?? error }),
        })
      )}
    </div>
  );
}
