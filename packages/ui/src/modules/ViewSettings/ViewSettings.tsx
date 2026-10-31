// Brief
// Purpose: say which fields a view shows, and in what order.
// Main task: hide a shown field, show a hidden one, drag the shown ones into order.
// Leaves out: switches (an off switch read louder than an on one), grips on rows that can't move, sentences.
//
// What a view shows (spec 0003, the view bars): a table's columns or a board
// card's fields, split Attio style into Shown (in order, dragged by a grip
// that appears on hover) and Hidden (one press adds it), system fields
// (Created at, Record ID) apart under System.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { GridList, GridListItem, type Key } from 'react-aria-components';
import { Button } from '../../atoms/Button/Button.tsx';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import { iconOf } from '../../fields/registry.ts';
import type { FieldAttribute } from '../../fields/types.ts';
import { SortableList, SortableRowGrip } from '../../lib/drag/drag.tsx';
import { focusLater } from '../../lib/focus-later.ts';
import { memoIntl } from '../../lib/intl-memo.ts';
import { reorder } from '../../lib/reorder.ts';
import { Field } from '../../molecules/Field/Field.tsx';
import { useFormatSettings } from '../../provider/context.ts';
import styles from './ViewSettings.module.css';
import { strings } from './strings.ts';

/** One attribute in a view, in its place, shown or not. */
export interface ViewField {
  readonly attribute: FieldAttribute;
  readonly isShown: boolean;
  /** Always shown and first: the record's name. */
  readonly isLocked?: boolean;
}

/** Props for ViewSettings. */
export interface ViewSettingsProps {
  /** What it sets: "Columns" for a table, "Card fields" for a board. Names the lists for screen readers. */
  readonly label: string;
  /** Every attribute the view can show, in its order. */
  readonly fields: readonly ViewField[];
  readonly onChange: (next: readonly ViewField[]) => void;
  /** Shows what the view shows, with nothing to change: a view you can't edit. */
  readonly isReadOnly?: boolean;
  /**
   * The most rows that may be shown, the locked one aside: a board card's six
   * fields. Shown counts against it ("3 of 6"), and at the limit the hidden
   * rows can't be added until one is hidden.
   */
  readonly maxShown?: number;
  /**
   * Pinned under the lists, after a hairline: a table's "Add attribute", since a new attribute is one more column
   * here. It stays in view while the lists scroll.
   */
  readonly footer?: ReactNode;
  /** Above the lists, apart from them after a hairline: a table's Group by (a `Select`). */
  readonly header?: ReactNode;
}

/** Past this many attributes, a search field narrows the lists. */
const SEARCH_AFTER = 8;

type ListId = 'shown' | 'hidden' | 'system';

/**
 * A view's columns or card fields in three React Aria GridLists: Shown (the
 * locked name first, then the rest in order, each with Hide and a grip on
 * hover), Hidden (Show, or Enter on the row) and System. Long lists get a
 * search field pinned at the top; the footer stays pinned at the bottom.
 */
export function ViewSettings({
  label,
  fields,
  onChange,
  isReadOnly = false,
  maxShown,
  footer,
  header,
}: ViewSettingsProps) {
  const { locale } = useFormatSettings();
  const [query, setQuery] = useState('');
  const needle = query.trim().toLocaleLowerCase(locale);
  const number = (value: number) => memoIntl(`plain:${locale}`, () => new Intl.NumberFormat(locale)).format(value);
  const matches = (field: ViewField) =>
    needle === '' || field.attribute.name.toLocaleLowerCase(locale).includes(needle);
  const isShown = (field: ViewField) => field.isShown || field.isLocked === true;
  const shownFree = fields.filter((field) => field.isShown && field.isLocked !== true).length;
  const isFull = maxShown !== undefined && shownFree >= maxShown;
  const countText =
    maxShown === undefined
      ? number(fields.filter(isShown).length)
      : strings.shownOf(number(shownFree), number(maxShown));
  // The locked name always leads Shown, whatever its place in `fields`.
  const shown = [
    ...fields.filter((field) => field.isLocked === true),
    ...fields.filter((field) => field.isShown && field.isLocked !== true),
  ].filter(matches);
  const hidden = fields.filter((field) => !isShown(field) && field.attribute.isSystem !== true && matches(field));
  const system = fields.filter((field) => !isShown(field) && field.attribute.isSystem === true && matches(field));

  // A row that moves to the other list takes its place's focus with it: the row now in its place, else the row
  // before, else the row itself in its new list, so hiding three columns in a row is three presses of Enter.
  const lists = useRef<Partial<Record<ListId, HTMLDivElement | null>>>({});
  const focusNext = useRef<
    | {
        readonly list: ListId;
        readonly index: number;
        readonly id: string;
        /** The fields as they were asked to change: focus moves once new ones arrive, not on a render before. */
        readonly before: readonly ViewField[];
      }
    | undefined
  >(undefined);
  useEffect(() => {
    const target = focusNext.current;
    if (target === undefined || target.before === fields) return;
    focusNext.current = undefined;
    focusLater(() => {
      const rows = [...(lists.current[target.list]?.querySelectorAll<HTMLElement>('[role="row"]') ?? [])];
      const own = Object.values(lists.current)
        .flatMap((list) => [...(list?.querySelectorAll<HTMLElement>('[role="row"]') ?? [])])
        .find((row) => row.dataset.key === target.id);
      return rows[target.index] ?? rows.at(-1) ?? own ?? null;
    });
  });

  const setShown = (id: string, next: boolean, from: ListId, index: number) => {
    focusNext.current = { list: from, index, id, before: fields };
    onChange(fields.map((each) => (each.attribute.id === id ? { ...each, isShown: next } : each)));
  };

  const isFiltering = needle !== '';
  const nameOf = (id: string) => fields.find((field) => field.attribute.id === id)?.attribute.name ?? id;

  const row = (field: ViewField, list: ListId, index: number) => {
    const { attribute } = field;
    const isLocked = field.isLocked === true;
    const canMove = list === 'shown' && !isLocked && !isFiltering && !isReadOnly && shown.length > 2;
    let end: ReactNode = null;
    if (isLocked) {
      end = (
        <span className={styles.locked}>
          <Icon name="lock" size="sm" tone="muted" label={strings.locked} />
        </span>
      );
    } else if (!isReadOnly && list === 'shown') {
      end = (
        <Button
          variant="ghost"
          icon="eye-off"
          label={strings.hide(attribute.name)}
          onPress={() => {
            setShown(attribute.id, false, list, index);
          }}
        />
      );
    } else if (!isReadOnly) {
      end = (
        <Button
          variant="ghost"
          icon="plus"
          label={strings.show(attribute.name)}
          isDisabled={isFull}
          onPress={() => {
            setShown(attribute.id, true, list, index);
          }}
        />
      );
    }
    return (
      <GridListItem
        key={attribute.id}
        id={attribute.id}
        textValue={attribute.name}
        className={list === 'shown' ? `${styles.row ?? ''} ${styles.shownRow ?? ''}` : styles.row}
      >
        {list === 'shown' && (
          <span className={styles.grip} data-can-move={canMove || undefined}>
            <SortableRowGrip
              id={attribute.id}
              label={strings.move(attribute.name)}
              isDisabled={!canMove}
              refusesDrop={isLocked}
            />
          </span>
        )}
        <Icon name={iconOf(attribute)} size="sm" tone="muted" />
        <span className={styles.name}>{attribute.name}</span>
        {end}
      </GridListItem>
    );
  };

  // A hidden or system row is added by Enter or a press anywhere on it, as well as by its button.
  const addOnAction = (list: ListId, items: readonly ViewField[]) =>
    isReadOnly
      ? {}
      : {
          onAction: (key: Key) => {
            const index = items.findIndex((field) => field.attribute.id === String(key));
            if (!isFull && index >= 0) setShown(String(key), true, list, index);
          },
          // At the limit the rows are disabled too, so Enter says so rather than doing nothing.
          ...(isFull ? { disabledKeys: items.map((field) => field.attribute.id) } : {}),
        };

  const section = (list: Exclude<ListId, 'shown'>, title: string, items: readonly ViewField[]) =>
    items.length === 0 ? null : (
      <section className={styles.section} aria-label={title}>
        <div className={styles.head}>
          <span className={styles.label}>{title}</span>
          <span className={styles.count}>{isFull && !isReadOnly ? strings.atLimit : number(items.length)}</span>
        </div>
        <GridList
          ref={(element) => {
            lists.current[list] = element;
          }}
          aria-label={strings.list(label, title)}
          items={items.map((field, index) => ({ id: field.attribute.id, field, index }))}
          className={styles.list}
          {...addOnAction(list, items)}
        >
          {({ field, index }) => row(field, list, index)}
        </GridList>
      </section>
    );

  const noMatches = isFiltering && shown.length + hidden.length + system.length === 0;
  return (
    <div className={styles.root}>
      {header !== undefined && <div className={styles.lead}>{header}</div>}
      {fields.length > SEARCH_AFTER && (
        <div className={styles.search}>
          <Field
            label={strings.searchFields}
            isLabelHidden
            placeholder={strings.findField}
            variant="search"
            size="sm"
            value={query}
            onChange={setQuery}
            onEscape={() => {
              setQuery('');
            }}
          />
        </div>
      )}
      {noMatches ? (
        <span className={styles.empty}>{strings.noMatches}</span>
      ) : (
        <>
          {shown.length > 0 && (
            <section className={styles.section} aria-label={strings.shown}>
              <div className={styles.head}>
                <span className={styles.label}>{strings.shown}</span>
                <span className={styles.count}>{countText}</span>
              </div>
              <SortableList
                ids={shown.map((field) => field.attribute.id)}
                nameOf={nameOf}
                onMove={(move) => {
                  // The locked row stays first: nothing lands above it.
                  const target = fields.find((field) => field.attribute.id === move.targetId);
                  if (target?.isLocked === true && move.position === 'before') return;
                  onChange(
                    reorder(fields, (field) => field.attribute.id, new Set([move.id]), move.targetId, move.position),
                  );
                }}
              >
                <GridList
                  ref={(element) => {
                    lists.current.shown = element;
                  }}
                  aria-label={strings.list(label, strings.shown)}
                  items={shown.map((field, index) => ({ id: field.attribute.id, field, index }))}
                  className={styles.list}
                >
                  {({ field, index }) => row(field, 'shown', index)}
                </GridList>
              </SortableList>
            </section>
          )}
          {section('hidden', strings.hidden, hidden)}
          {section('system', strings.system, system)}
        </>
      )}
      {footer !== undefined && <div className={styles.foot}>{footer}</div>}
    </div>
  );
}
