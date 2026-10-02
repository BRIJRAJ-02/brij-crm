// A view's sorts (spec 0003, the view bars): a reorderable list, the first
// deciding first, each an attribute and a direction. It holds contracts'
// SortRule list and hands back every change.
import { MAX_SORTS, type SortRule } from '@crm/contracts/values';
import { useEffect, useRef } from 'react';
import { GridList, GridListItem, useDragAndDrop } from 'react-aria-components';
import { Button } from '../../atoms/Button/Button.tsx';
import { DragHandle } from '../../atoms/DragHandle/DragHandle.tsx';
import { fieldTypeOf } from '../../fields/registry.ts';
import type { FieldAttribute } from '../../fields/types.ts';
import { focusLater } from '../../lib/focus-later.ts';
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
  // A control that leaves with its change (a row's old attribute, a removed row,
  // Add sort at the limit) hands focus on: to the row now in its place, or to Add sort.
  const rootRef = useRef<HTMLDivElement>(null);
  const focusNext = useRef<{ readonly row: string } | 'add' | undefined>(undefined);
  useEffect(() => {
    const target = focusNext.current;
    const root = rootRef.current;
    if (target === undefined || root === null) return;
    focusNext.current = undefined;
    focusLater(() => {
      const row = target === 'add' ? undefined : root.querySelector(`[data-key="${CSS.escape(target.row)}"]`);
      return (
        row?.querySelector<HTMLElement>('button[aria-haspopup]') ??
        root.querySelector<HTMLElement>('[data-adder] button') ??
        root.querySelector<HTMLElement>('button[aria-haspopup]')
      );
    });
  });
  const change = (next: readonly SortRule[], focus: { readonly row: string } | 'add') => {
    focusNext.current = focus;
    onChange(next);
  };
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
    change([...value, { attributeId: String(key), direction: 'ascending' }], { row: String(key) });
  };
  const adder =
    isReadOnly || value.length >= MAX_SORTS || unused.length === 0 ? null : (
      <span className={styles.adder} data-adder="">
        <MenuTrigger>
          <Button variant="dashed" icon="plus">
            {strings.addSort}
          </Button>
          <AttributeMenu attributes={unused} onAction={add} />
        </MenuTrigger>
      </span>
    );
  if (value.length === 0) {
    return (
      <div ref={rootRef} className={styles.root}>
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
    <div ref={rootRef} className={styles.root}>
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
              {!isReadOnly && <DragHandle label={strings.move(name)} />}
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
                        change(
                          value.map((each) =>
                            each.attributeId === rule.attributeId ? { ...rule, attributeId: String(key) } : each,
                          ),
                          { row: String(key) },
                        );
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
                      const after = value[index + 1] ?? value[index - 1];
                      change(
                        value.filter((each) => each.attributeId !== rule.attributeId),
                        after === undefined ? 'add' : { row: after.attributeId },
                      );
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
