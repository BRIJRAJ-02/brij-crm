// The editor for link types that hold several values (emails, phones,
// domains, URLs): the values as removable chips, and a Field to add one more.
// Each change commits the whole list, checked with the attribute's schema.
// A pasted list adds each value; a chip's menu makes it the primary (first)
// or edits it in the add field, where Enter puts it back in its place and Esc
// or leaving it empty keeps the value as it was; chips here never navigate.
import type { AttributeType } from '@crm/contracts/values';
import { useRef, useState, type ReactNode } from 'react';
import { Button } from '../atoms/Button/Button.tsx';
import { LinkChip } from '../atoms/LinkChip/LinkChip.tsx';
import type { ProviderName } from '../atoms/ProviderMark/ProviderMark.tsx';
import { focusLater } from '../lib/focus-later.ts';
import { splitPasted } from '../lib/parse-input.ts';
import { Field, type FieldProps } from '../molecules/Field/Field.tsx';
import { Menu, MenuItem, MenuTrigger } from '../molecules/Menu/Menu.tsx';
import { FieldGroup } from '../molecules/FieldGroup/FieldGroup.tsx';
import { strings as fieldStrings } from '../molecules/Field/strings.ts';
import styles from './ListEditor.module.css';
import { strings } from './strings.ts';
import type { EditorProps } from './types.ts';
import { isCompactSurface, splitsOnSpaces, toCommittable } from './values.ts';

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
  /** Text pasted into the add field: a list ("a@x.com, b@x.com") adds each value at once. */
  readonly onPasteText: (text: string) => boolean;
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
  // The value being edited in the add field: it stays in the list, hidden, until Enter replaces it in place.
  const [editingIndex, setEditingIndex] = useState<number | undefined>(undefined);
  const addRef = useRef<HTMLDivElement>(null);
  const chipRefs = useRef(new Map<string, HTMLLIElement>());
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
  /**
   * Adds each value in `text` (one typed value, or a pasted list): the ones that check go in, in order; the first
   * that doesn't stays in the add field with its sentence, with any after it, so nothing typed is lost.
   */
  const addText = (text: string): boolean => {
    const parts = splitPasted(text, { onSpaces: splitsOnSpaces(attribute.type) });
    if (parts.length === 0) return false;
    const added: V[] = [];
    let refusal: { readonly message: string; readonly rest: string } | undefined;
    // The value being edited doesn't count toward the limit: what is added takes its place.
    const kept = values.length - (editingIndex === undefined ? 0 : 1);
    for (const [index, part] of parts.entries()) {
      // At the list's limit, one more is refused here, and what was typed stays to move or fix.
      if (attribute.limit !== undefined && kept + added.length >= attribute.limit.count) {
        refusal = { message: attribute.limit.message, rest: parts.slice(index).join(', ') };
        break;
      }
      const one = checkOne(part);
      if (!one.ok) {
        refusal = { message: one.message, rest: parts.slice(index).join(', ') };
        break;
      }
      added.push(one.value);
    }
    if (added.length > 0) {
      const next =
        editingIndex === undefined
          ? [...values, ...added]
          : [...values.slice(0, editingIndex), ...added, ...values.slice(editingIndex + 1)];
      if (!commitList(next)) return true;
      setEditingIndex(undefined);
    }
    setDraft(refusal?.rest ?? '');
    if (refusal !== undefined) setMessage(refusal.message);
    return true;
  };
  /** Ends an edit with the value as it was: the list never changed, so only the add field empties. */
  const keepEdited = () => {
    setEditingIndex(undefined);
    setDraft('');
    setMessage(undefined);
  };
  const add = () => {
    if (draft.trim() !== '') addText(draft);
    else if (editingIndex !== undefined) keepEdited();
  };
  const escape = () => {
    if (editingIndex !== undefined) keepEdited();
    else onCancel?.();
  };
  const focusAddField = () => {
    focusLater(() => addRef.current?.querySelector('input'));
  };
  /** A pasted list adds at once; a single value is pasted as text, to be added with Enter. */
  const pasteText = (text: string): boolean => {
    if (splitPasted(text, { onSpaces: splitsOnSpaces(attribute.type) }).length < 2) return false;
    return addText(`${draft}${draft.trim() === '' ? '' : ', '}${text}`);
  };
  /** The value at `index` first: the primary, as Attio and Twenty read a list's first value. Focus follows the chip. */
  const makePrimary = (index: number) => {
    const chosen = values[index];
    if (chosen === undefined) return;
    if (!commitList([chosen, ...values.filter((_, at) => at !== index)])) return;
    focusLater(() => chipRefs.current.get(labelOf(chosen))?.querySelector('button'));
  };
  /** The value at `index` into the add field to change: Enter puts it back in its place, Esc keeps it as it was. */
  const edit = (index: number) => {
    const chosen = values[index];
    if (chosen === undefined) return;
    setEditingIndex(index);
    setDraft(labelOf(chosen));
    setMessage(undefined);
    focusAddField();
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
  const shown = values.flatMap((value, index) => (index === editingIndex ? [] : [{ value, index }]));
  const isLabelledAbove = !isCompact && shown.length > 0;
  const chips = shown.length > 0 && (
    <ul className={styles.list} aria-label={attribute.name}>
      {shown.map(({ value, index }) => (
        // Keyed by the value, so a chip made primary moves with its focus instead of another chip taking its place.
        <li
          key={values.findIndex((each) => labelOf(each) === labelOf(value)) === index ? labelOf(value) : String(index)}
          className={styles.item}
          ref={(node) => {
            if (node === null) chipRefs.current.delete(labelOf(value));
            else chipRefs.current.set(labelOf(value), node);
          }}
        >
          {/* The chip opens its menu, never its link: a press inside an editor must not leave the page. */}
          <MenuTrigger>
            <LinkChip
              href={hrefOf(value)}
              isPressable
              label={strings.valueActions(labelOf(value))}
              isDisabled={isDisabled}
              {...chipExtras(value)}
            >
              {labelOf(value)}
            </LinkChip>
            <Menu
              label={strings.valueActions(labelOf(value))}
              onAction={(key) => {
                if (key === 'primary') makePrimary(index);
                if (key === 'edit') edit(index);
              }}
            >
              {index > 0 && (
                <MenuItem id="primary" icon="arrow-up">
                  {strings.makePrimary}
                </MenuItem>
              )}
              <MenuItem id="edit" icon="pencil">
                {strings.editValue}
              </MenuItem>
            </Menu>
          </MenuTrigger>
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
      <div ref={addRef} className={styles.add}>
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
              if (event.key === 'Enter' && !event.nativeEvent.isComposing && draft.trim() !== '')
                event.preventDefault();
            }}
            // A record's value, never the viewer's own: no browser autofill, and no password manager taking it for a login.
            autoComplete="off"
            onBlur={add}
            onPaste={(event) => {
              if (pasteText(event.clipboardData.getData('text/plain'))) event.preventDefault();
            }}
            // Opened from a grid cell: keys go to the add field, never to a chip's link.
            // eslint-disable-next-line jsx-a11y-x/no-autofocus -- the editor was opened on purpose, from the cell
            autoFocus={autoOpen}
            isDisabled={isDisabled}
            {...(onCancel === undefined && editingIndex === undefined ? {} : { onEscape: escape })}
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
            onPasteText: pasteText,
            autoFocus: autoOpen,
            isDisabled,
            ...(onCancel === undefined && editingIndex === undefined ? {} : { onEscape: escape }),
            ...((message ?? error) === undefined ? {} : { error: message ?? error }),
          })
        )}
      </div>
    </div>
  );
}
