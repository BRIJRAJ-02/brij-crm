// A view's sorts (spec 0003, the view bars): a reorderable list, the first
// deciding first, each an attribute and a direction. It holds contracts'
// SortRule list and hands back every change.
import { MAX_SORTS, type SortRule } from '@crm/contracts/values';
import { Button as AriaButton, GridList, GridListItem, useDragAndDrop } from 'react-aria-components';
import { Button } from '../../atoms/Button/Button.tsx';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import { fieldTypeOf } from '../../fields/registry.ts';
import type { FieldAttribute } from '../../fields/types.ts';
import { reorder } from '../../lib/reorder.ts';
import { EmptyState } from '../../molecules/EmptyState/EmptyState.tsx';
import { Menu, MenuItem, MenuTrigger, type MenuKey } from '../../molecules/Menu/Menu.tsx';
import { Select } from '../../molecules/Select/Select.tsx';
import styles from './SortBuilder.module.css';
import { strings } from './strings.ts';

/** Props for SortBuilder. */
export interface SortBuilderProps {
  /** The attributes a view can sort by. */
  readonly attributes: readonly FieldAttribute[];
  readonly value: readonly SortRule[];
  readonly onChange: (next: readonly SortRule[]) => void;
  /** Shows the sorts with nothing to change: a view you can't edit. */
  readonly isReadOnly?: boolean;
}

/**
 * A view's sorts as a React Aria GridList: drag a sort by its handle, or by
 * keyboard (Enter on the handle, the arrows, Enter), to change which decides
 * first. Each row picks its attribute and direction; Add sort adds one, up to
 * five, each attribute once.
 */
export function SortBuilder({ attributes, value, onChange, isReadOnly = false }: SortBuilderProps) {
  const { dragAndDropHooks } = useDragAndDrop({
    getItems: (keys) => [...keys].map((key) => ({ 'text/plain': String(key) })),
    onReorder: (event) => {
      onChange(
        reorder(
          value,
          (rule) => rule.attributeId,
          new Set([...event.keys].map(String)),
          String(event.target.key),
          event.target.dropPosition === 'after' ? 'after' : 'before',
        ),
      );
    },
  });
  const nameOf = (id: string) => attributes.find((each) => each.id === id)?.name ?? id;
  const unused = attributes.filter((attribute) => !value.some((rule) => rule.attributeId === attribute.id));
  const add = (key: MenuKey) => {
    onChange([...value, { attributeId: String(key), direction: 'ascending' }]);
  };
  const adder =
    isReadOnly || value.length >= MAX_SORTS || unused.length === 0 ? null : (
      <MenuTrigger>
        <Button variant="ghost" icon="plus">
          {strings.addSort}
        </Button>
        <AttributeMenu attributes={unused} onAction={add} />
      </MenuTrigger>
    );
  if (value.length === 0) {
    return (
      <div className={styles.root}>
        <EmptyState
          title={strings.noSorts}
          icon="arrow-down-wide-narrow"
          {...(adder === null ? {} : { actions: adder })}
        >
          {strings.noSortsText}
        </EmptyState>
      </div>
    );
  }
  const rows = value.map((rule, index) => ({ id: rule.attributeId, rule, index }));
  return (
    <div className={styles.root}>
      <GridList
        aria-label={strings.label}
        items={rows}
        className={styles.list}
        {...(isReadOnly ? {} : { dragAndDropHooks })}
      >
        {({ rule, index }) => {
          const name = nameOf(rule.attributeId);
          const attribute = attributes.find((each) => each.id === rule.attributeId);
          const replace = (next: SortRule) => {
            onChange(value.map((each) => (each.attributeId === rule.attributeId ? next : each)));
          };
          return (
            <GridListItem id={rule.attributeId} textValue={name} className={styles.row}>
              {!isReadOnly && (
                <AriaButton slot="drag" className={styles.handle} aria-label={strings.move(name)}>
                  <Icon name="grip-vertical" size="sm" />
                </AriaButton>
              )}
              <span className={styles.lead}>{index === 0 ? strings.sortBy : strings.thenBy}</span>
              {isReadOnly ? (
                <span className={styles.text}>
                  {name}, {rule.direction === 'ascending' ? strings.ascending : strings.descending}
                </span>
              ) : (
                <>
                  <MenuTrigger>
                    <Button
                      variant="secondary"
                      icon={attribute === undefined ? 'circle-question-mark' : fieldTypeOf(attribute.type).icon}
                      iconRight="chevron-down"
                    >
                      {name}
                    </Button>
                    <AttributeMenu
                      attributes={[...(attribute === undefined ? [] : [attribute]), ...unused]}
                      onAction={(key) => {
                        replace({ ...rule, attributeId: String(key) });
                      }}
                    />
                  </MenuTrigger>
                  <Select
                    label={strings.direction(name)}
                    isLabelHidden
                    size="sm"
                    value={rule.direction}
                    items={[
                      { id: 'ascending', label: strings.ascending, icon: 'arrow-up-narrow-wide' },
                      { id: 'descending', label: strings.descending, icon: 'arrow-down-wide-narrow' },
                    ]}
                    onChange={(next) => {
                      if (next === 'ascending' || next === 'descending') replace({ ...rule, direction: next });
                    }}
                  />
                  <Button
                    variant="ghost"
                    icon="x"
                    label={strings.remove(name)}
                    onPress={() => {
                      onChange(value.filter((each) => each.attributeId !== rule.attributeId));
                    }}
                  />
                </>
              )}
            </GridListItem>
          );
        }}
      </GridList>
      {adder}
    </div>
  );
}

/** A searchable menu of attributes, each with its type's icon. */
function AttributeMenu({
  attributes,
  onAction,
}: {
  readonly attributes: readonly FieldAttribute[];
  readonly onAction: (key: MenuKey) => void;
}) {
  return (
    <Menu label={strings.attributes} search={{ label: strings.searchAttributes }} onAction={onAction}>
      {attributes.map((attribute) => (
        <MenuItem key={attribute.id} id={attribute.id} icon={fieldTypeOf(attribute.type).icon}>
          {attribute.name}
        </MenuItem>
      ))}
    </Menu>
  );
}
