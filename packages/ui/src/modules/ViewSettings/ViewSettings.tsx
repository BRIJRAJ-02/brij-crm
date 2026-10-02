// What a view shows (spec 0003, the view bars): a table's columns or a board
// card's fields, each shown or hidden by a switch and reordered by drag and
// drop, by pointer or keyboard.
import { useState } from 'react';
import { GridList, GridListItem, useDragAndDrop } from 'react-aria-components';
import { DragHandle } from '../../atoms/DragHandle/DragHandle.tsx';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import { Switch } from '../../atoms/Switch/Switch.tsx';
import { fieldTypeOf } from '../../fields/registry.ts';
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
}

/** Past this many attributes, a search field narrows the list. */
const SEARCH_AFTER = 8;

/**
 * A view's columns or card fields as a React Aria GridList: a switch per row
 * shows or hides it, and its handle reorders it. A locked row (the record's
 * name) is always shown and stays first. Long lists get a search field.
 */
export function ViewSettings({ label, fields, onChange, isReadOnly = false }: ViewSettingsProps) {
  const { locale } = useFormatSettings();
  const [query, setQuery] = useState('');
  const needle = query.trim().toLocaleLowerCase(locale);
  const { dragAndDropHooks } = useDragAndDrop({
    // Reordering a filtered list would hide where things land, so it waits for the search to clear.
    isDisabled: needle !== '' || isReadOnly,
    getItems: (keys) => [...keys].map((key) => ({ 'text/plain': String(key) })),
    // The locked row stays first: nothing drops above it.
    getDropOperation: (target) =>
      target.type === 'item' &&
      target.dropPosition !== 'after' &&
      fields.some((field) => field.isLocked === true && field.attribute.id === String(target.key))
        ? 'cancel'
        : 'move',
    onReorder: (event) => {
      onChange(
        reorder(
          fields,
          (field) => field.attribute.id,
          new Set([...event.keys].map(String)),
          String(event.target.key),
          event.target.dropPosition === 'after' ? 'after' : 'before',
        ),
      );
    },
  });
  const number = (value: number) => memoIntl(`plain:${locale}`, () => new Intl.NumberFormat(locale)).format(value);
  const listed =
    needle === '' ? fields : fields.filter((field) => field.attribute.name.toLocaleLowerCase(locale).includes(needle));
  const shownCount = fields.filter((field) => field.isShown || field.isLocked === true).length;
  return (
    <div className={styles.root}>
      <div className={styles.head}>
        <span className={styles.label}>{label}</span>
        <span className={styles.count}>{strings.shown(number(shownCount), number(fields.length))}</span>
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
      <GridList
        aria-label={label}
        items={listed.map((field) => ({ id: field.attribute.id, field }))}
        className={styles.list}
        renderEmptyState={() => <span className={styles.empty}>{strings.noMatches}</span>}
        dragAndDropHooks={dragAndDropHooks}
      >
        {({ field }) => {
          const { attribute } = field;
          return (
            <GridListItem id={attribute.id} textValue={attribute.name} className={styles.row}>
              {field.isLocked === true || needle !== '' || isReadOnly ? (
                <>
                  <span className={styles.spacer} aria-hidden="true" />
                  <DragHandle label={strings.move(attribute.name)} isDisabled />
                </>
              ) : (
                <DragHandle label={strings.move(attribute.name)} />
              )}
              <Icon name={fieldTypeOf(attribute.type).icon} size="sm" tone="muted" />
              <span className={styles.name}>{attribute.name}</span>
              {field.isLocked === true ? (
                <span className={styles.locked}>{strings.locked}</span>
              ) : (
                <Switch
                  label={strings.show(attribute.name)}
                  isLabelHidden
                  isSelected={field.isShown}
                  isReadOnly={isReadOnly}
                  onChange={(isShown) => {
                    onChange(fields.map((each) => (each.attribute.id === attribute.id ? { ...each, isShown } : each)));
                  }}
                />
              )}
            </GridListItem>
          );
        }}
      </GridList>
    </div>
  );
}
