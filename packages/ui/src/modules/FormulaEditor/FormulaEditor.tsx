// FormulaEditor (spec 0015, 0015-formulas.md; pulled forward from spec
// 0003's milestone 4): a formula typed in a field. Typing `{{` suggests the
// object's attributes and typing a word suggests the functions, in a list
// under the field while focus stays in it (SuggestionList, as the composer's
// mentions). Under the field, the check line says what it gives or the first
// mistake with its character, politely announced. Presentational: the text,
// the attributes and the check come in as props.
import { FUNCTIONS } from '@crm/contracts/formula';
import type { AttributeType } from '@crm/contracts/values';
import { useId, useRef, useState, type KeyboardEvent, type SyntheticEvent } from 'react';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import { fieldTypeOf } from '../../fields/registry.ts';
import { Field } from '../../molecules/Field/Field.tsx';
import {
  SuggestionList,
  suggestionOptionId,
  type SuggestionRow,
} from '../../molecules/SuggestionList/SuggestionList.tsx';
import { strings } from './strings.ts';

/** An attribute a formula may name, by its API name. */
export interface FormulaEditorAttribute {
  readonly apiSlug: string;
  readonly title: string;
  readonly type: AttributeType;
}

/** What the check found: the result in words ("Gives a number"), or the first error with its character. */
export type FormulaCheck = { readonly result: string } | { readonly error: string } | undefined;

/** Props for FormulaEditor. */
export interface FormulaEditorProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** The object's attributes a formula can use (archived and unusable ones left out by the screen). */
  readonly attributes: readonly FormulaEditorAttribute[];
  /** The check of `value`, worked out by the caller with `checkFormulaSource`. */
  readonly check: FormulaCheck;
  readonly isReadOnly?: boolean;
  readonly readOnlyReason?: string;
}

/** What is being typed at the caret: an attribute after `{{`, or a function name. */
type Typing =
  | { readonly kind: 'attribute'; readonly start: number; readonly query: string }
  | { readonly kind: 'function'; readonly start: number; readonly query: string };

/** The attribute or function name being typed just before the caret, if any. */
function typingAt(text: string, caret: number): Typing | undefined {
  const before = text.slice(0, caret);
  const open = before.lastIndexOf('{{');
  if (open !== -1 && !before.slice(open).includes('}}') && /^\{\{[a-z0-9_]*$/.test(before.slice(open))) {
    return { kind: 'attribute', start: open, query: before.slice(open + 2) };
  }
  // A word at a word's start, outside a text in quotes (an even number of quotes before it).
  const word = /[A-Za-z_]+$/.exec(before);
  if (word === null) return undefined;
  const quotes = (before.slice(0, word.index).match(/"/g) ?? []).length;
  if (quotes % 2 === 1 || /[A-Za-z0-9_.]$/.test(before.slice(0, word.index))) return undefined;
  return { kind: 'function', start: word.index, query: word[0] };
}

/** A formula field with attribute and function suggestions and its check line. */
export function FormulaEditor({ value, onChange, attributes, check, isReadOnly, readOnlyReason }: FormulaEditorProps) {
  const listId = useId();
  const fieldRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState(value.length);
  const [isDismissed, setDismissed] = useState(false);
  const [active, setActive] = useState(0);

  const typing = isReadOnly === true || isDismissed ? undefined : typingAt(value, caret);
  const query = typing?.query.toLowerCase() ?? '';
  const choices: readonly { readonly row: SuggestionRow; readonly insert: string }[] =
    typing === undefined
      ? []
      : typing.kind === 'attribute'
        ? attributes
            .filter((attribute) => attribute.apiSlug.includes(query) || attribute.title.toLowerCase().includes(query))
            .slice(0, 50)
            .map((attribute) => ({
              row: {
                key: attribute.apiSlug,
                leading: <Icon name={fieldTypeOf(attribute.type).icon} size="sm" tone="muted" />,
                label: attribute.title,
                detail: attribute.apiSlug,
              },
              insert: `{{${attribute.apiSlug}}}`,
            }))
        : FUNCTIONS.filter((each) => each.name.toLowerCase().startsWith(query)).map((each) => ({
            row: {
              key: each.name,
              leading: <Icon name="square-function" size="sm" tone="muted" />,
              label: each.signature,
              detail: each.description,
            },
            insert: `${each.name}(`,
          }));
  const isOpen = typing !== undefined && (typing.kind === 'attribute' || choices.length > 0);
  const highlighted = Math.min(active, Math.max(0, choices.length - 1));

  const pick = (index: number) => {
    const choice = choices[index];
    if (choice === undefined || typing === undefined) return;
    const next = value.slice(0, typing.start) + choice.insert + value.slice(caret);
    const at = typing.start + choice.insert.length;
    onChange(next);
    setCaret(at);
    setActive(0);
    // The caret goes after what was put in, once the field has the new text.
    requestAnimationFrame(() => {
      fieldRef.current?.setSelectionRange(at, at);
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (!isOpen) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((highlighted + step + choices.length) % Math.max(1, choices.length));
    } else if ((event.key === 'Enter' || event.key === 'Tab') && choices.length > 0) {
      event.preventDefault();
      pick(highlighted);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setDismissed(true);
    }
  };

  const onSelect = (event: SyntheticEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setCaret(event.currentTarget.selectionStart ?? value.length);
  };

  const result = check !== undefined && 'result' in check ? check.result : undefined;
  const error = check !== undefined && 'error' in check ? check.error : undefined;
  return (
    <>
      <Field
        ref={fieldRef}
        label={strings.label}
        value={value}
        isMultiline
        isVerbatim
        maxLength={2000}
        placeholder={strings.placeholder}
        hint={result ?? strings.emptyHint}
        {...(error === undefined ? {} : { error })}
        onChange={(next) => {
          onChange(next);
          setDismissed(false);
          setActive(0);
        }}
        onSelect={onSelect}
        onKeyDown={onKeyDown}
        combobox={{
          listId,
          isExpanded: isOpen,
          ...(isOpen && choices.length > 0 ? { activeId: suggestionOptionId(listId, highlighted) } : {}),
        }}
        {...(isReadOnly === true ? { isReadOnly: true } : {})}
        {...(readOnlyReason === undefined ? {} : { readOnlyReason })}
      />
      {/* The check line, said politely as it changes, so a screen reader hears each mistake once. */}
      <VisuallyHidden>
        <span role="status">{error ?? result ?? ''}</span>
      </VisuallyHidden>
      {isOpen && (
        <SuggestionList
          anchorRef={fieldRef}
          id={listId}
          label={typing.kind === 'attribute' ? strings.attributes : strings.functions}
          rows={choices.map((choice) => choice.row)}
          activeIndex={highlighted}
          emptyText={strings.noMatch}
          onPick={pick}
          onHighlight={setActive}
        />
      )}
    </>
  );
}
