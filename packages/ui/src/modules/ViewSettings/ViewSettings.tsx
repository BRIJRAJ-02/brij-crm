// What a view shows (spec 0003, the view bars): a table's columns or a board
// card's fields, each shown or hidden by a switch and reordered by drag and
// drop, by pointer or keyboard.
import { useState, type ReactNode } from 'react';
import { GridList, GridListItem } from 'react-aria-components';
import { SortableList, SortableRowGrip } from '../../lib/drag/drag.tsx';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import { Switch } from '../../atoms/Switch/Switch.tsx';
import { iconOf } from '../../fields/registry.ts';
import type { FieldAttribute } from '../../fields/types.ts';
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
  /** What it sets: "Columns" for a table, "Card fields" for a board. */
  readonly label: string;
  /** Every attribute the view can show, in its order. */
  readonly fields: readonly ViewField[];
  readonly onChange: (next: readonly ViewField[]) => void;
  /** Shows what the view shows, with nothing to change: a view you can't edit. */
  readonly isReadOnly?: boolean;
  /**
   * The most rows that may be shown, the locked one aside: a board card's six
   * fields. The head counts against it ("3 of 6 shown"), and at the limit the
   * hidden rows' switches are disabled until one is hidden.
   */
  readonly maxShown?: number;
  /**
   * Under the list, after a hairline: a table's "Add attribute", since a new
   * attribute is one more column here (it was a button of its own in the view
   * bar until the bar was simplified, 21 October 2026).
   */
  readonly footer?: ReactNode;
  /** Above the list, apart from it after a hairline: a table's Group by (a `Select`, 13 Oct reference batch 4). */
  readonly header?: ReactNode;
}

/** Past this many attributes, a search field narrows the list. */
const SEARCH_AFTER = 8;

/**
 * A view's columns or card fields as a React Aria GridList: a switch per row
 * shows or hides it, and its handle reorders it. A locked row (the record's
 * name) is always shown and stays first. Long lists get a search field.
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
  const listed =
    needle === '' ? fields : fields.filter((field) => field.attribute.name.toLocaleLowerCase(locale).includes(needle));
  const shownCount = fields.filter((field) => field.isShown || field.isLocked === true).length;
  const shownFree = fields.filter((field) => field.isShown && field.isLocked !== true).length;
  const isFull = maxShown !== undefined && shownFree >= maxShown;
  const countText =
    maxShown === undefined
      ? strings.shown(number(shownCount), number(fields.length))
      : strings.shown(number(shownFree), number(maxShown));
  return (
    <div className={styles.root}>
      {header !== undefined && <div className={styles.lead}>{header}</div>}
      <div className={styles.head}>
        <span className={styles.label}>{label}</span>
        <span className={styles.count}>{countText}</span>
      </div>
      {fields.length > SEARCH_AFTER && (
        <Field
          label={strings.searchFields}
          isLabelHidden
          variant="search"
          size="sm"
          value={query}
          onChange={setQuery}
        />
      )}
      <SortableList
        ids={listed.map((field) => field.attribute.id)}
        nameOf={(id) => fields.find((field) => field.attribute.id === id)?.attribute.name ?? id}
        onMove={(move) => {
          // The locked row stays first: nothing lands above it.
          const target = fields.find((field) => field.attribute.id === move.targetId);
          if (target?.isLocked === true && move.position === 'before') return;
          onChange(reorder(fields, (field) => field.attribute.id, new Set([move.id]), move.targetId, move.position));
        }}
      >
        <GridList
          aria-label={label}
          items={listed.map((field) => ({ id: field.attribute.id, field }))}
          className={styles.list}
          renderEmptyState={() => <span className={styles.empty}>{strings.noMatches}</span>}
        >
          {({ field }) => {
            const { attribute } = field;
            return (
              <GridListItem id={attribute.id} textValue={attribute.name} className={styles.row}>
                {/* Reordering a filtered list would hide where things land, so it waits for the search to clear. */}
                {(field.isLocked === true || needle !== '' || isReadOnly) && (
                  <span className={styles.spacer} aria-hidden="true" />
                )}
                <SortableRowGrip
                  id={attribute.id}
                  label={strings.move(attribute.name)}
                  isDisabled={field.isLocked === true || needle !== '' || isReadOnly}
                  refusesDrop={field.isLocked === true}
                />
                <Icon name={iconOf(attribute)} size="sm" tone="muted" />
                <span className={styles.name}>{attribute.name}</span>
                {field.isLocked === true ? (
                  <span className={styles.locked}>{strings.locked}</span>
                ) : (
                  <Switch
                    label={strings.show(attribute.name)}
                    isLabelHidden
                    isSelected={field.isShown}
                    isReadOnly={isReadOnly}
                    isDisabled={isFull && !field.isShown}
                    onChange={(isShown) => {
                      onChange(
                        fields.map((each) => (each.attribute.id === attribute.id ? { ...each, isShown } : each)),
                      );
                    }}
                  />
                )}
              </GridListItem>
            );
          }}
        </GridList>
      </SortableList>
      {footer !== undefined && <div className={styles.foot}>{footer}</div>}
    </div>
  );
}
