// A view's sorts (spec 0003, the view bars): a reorderable list, the first
// deciding first, each an attribute and a direction. It holds contracts'
// SortRule list and hands back every change.
import { MAX_SORTS, type SortRule } from '@crm/contracts/values';
import { useEffect, useRef } from 'react';
import { GridList, GridListItem } from 'react-aria-components';
import { Button } from '../../atoms/Button/Button.tsx';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import { Path } from '../../atoms/Path/Path.tsx';
import { iconOf } from '../../fields/registry.ts';
import type { FieldAttribute } from '../../fields/types.ts';
import { SortableList, SortableRowGrip } from '../../lib/drag/drag.tsx';
import { focusLater } from '../../lib/focus-later.ts';
import { reorder } from '../../lib/reorder.ts';
import { EmptyState } from '../../molecules/EmptyState/EmptyState.tsx';
import { Menu, MenuItem, MenuSection, MenuTrigger, type MenuKey } from '../../molecules/Menu/Menu.tsx';
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

const DIRECTIONS = [
  { id: 'ascending', icon: 'arrow-up-narrow-wide' },
  { id: 'descending', icon: 'arrow-down-wide-narrow' },
] as const;

/**
 * A view's sorts as a React Aria GridList: drag a sort by its handle, or by
 * keyboard (Enter on the handle, the arrows, Enter), to change which decides
 * first. Each row picks its attribute and direction, laid out as
 * FilterBuilder's rows are (the lead, then pickers of fixed widths, so rows
 * line up as columns; a long name is cut, whole in a tooltip); Add sort adds
 * one, up to five, each attribute once.
 */
export function SortBuilder({ attributes, value, onChange, isReadOnly = false }: SortBuilderProps) {
  // A control that leaves with its change (a row's old attribute, a removed row,
  // Add sort at the limit) hands focus on: to the row now in its place, or to Add sort. A direction chosen keeps
  // focus on its own picker, which the list would otherwise let fall to the page.
  const rootRef = useRef<HTMLDivElement>(null);
  type FocusTarget = { readonly row: string; readonly part?: 'direction' } | 'add';
  const focusNext = useRef<FocusTarget | undefined>(undefined);
  useEffect(() => {
    const target = focusNext.current;
    const root = rootRef.current;
    if (target === undefined || root === null) return;
    focusNext.current = undefined;
    focusLater(() => {
      const row = target === 'add' ? undefined : root.querySelector(`[data-key="${CSS.escape(target.row)}"]`);
      const pickers =
        row === null || row === undefined ? [] : [...row.querySelectorAll<HTMLElement>('button[aria-haspopup]')];
      return (
        (target !== 'add' && target.part === 'direction' ? pickers[1] : pickers[0]) ??
        root.querySelector<HTMLElement>('[data-adder] button') ??
        root.querySelector<HTMLElement>('button[aria-haspopup]')
      );
    });
  });
  const change = (next: readonly SortRule[], focus: FocusTarget) => {
    focusNext.current = focus;
    onChange(next);
  };
  const nameOf = (id: string) => attributes.find((each) => each.id === id)?.name ?? id;
  const unused = attributes.filter((attribute) => !value.some((rule) => rule.attributeId === attribute.id));
  const add = (key: MenuKey) => {
    change([...value, { attributeId: String(key), direction: 'ascending' }], { row: String(key) });
  };
  const adder =
    isReadOnly || value.length >= MAX_SORTS || unused.length === 0 ? null : (
      <span className={styles.adder} data-adder="">
        <MenuTrigger>
          <Button variant="ghost" icon="plus">
            {strings.addSort}
          </Button>
          <AttributeMenu attributes={unused} onAction={add} />
        </MenuTrigger>
      </span>
    );
  if (value.length === 0) {
    // One quiet line saying the order that runs, then Add sort: no tile or paragraph in a small popover.
    return (
      <div ref={rootRef} className={styles.root}>
        <EmptyState title={strings.noSorts} icon="arrow-down-wide-narrow" layout="row" />
        {adder}
      </div>
    );
  }
  const rows = value.map((rule, index) => ({ id: rule.attributeId, rule, index }));
  // A grip only where there is an order to change: one sort has nothing to move past.
  const isMovable = !isReadOnly && value.length > 1;
  const listClass = [styles.list, isReadOnly ? styles.listReadOnly : isMovable ? styles.listMovable : undefined]
    .filter(Boolean)
    .join(' ');
  return (
    <div ref={rootRef} className={styles.root}>
      <SortableList
        ids={rows.map((row) => row.id)}
        nameOf={nameOf}
        onMove={(move) => {
          onChange(reorder(value, (rule) => rule.attributeId, new Set([move.id]), move.targetId, move.position));
        }}
      >
        <GridList aria-label={strings.label} items={rows} className={listClass}>
          {({ rule, index }) => {
            const name = nameOf(rule.attributeId);
            const attribute = attributes.find((each) => each.id === rule.attributeId);
            const replace = (next: SortRule) => {
              change(
                value.map((each) => (each.attributeId === rule.attributeId ? next : each)),
                { row: rule.attributeId, part: 'direction' },
              );
            };
            return (
              <GridListItem id={rule.attributeId} textValue={name} className={styles.row}>
                {isMovable && <SortableRowGrip id={rule.attributeId} label={strings.move(name)} />}
                <span className={styles.lead}>{index === 0 ? strings.sortBy : strings.thenBy}</span>
                {isReadOnly ? (
                  <>
                    <span className={styles.attribute}>
                      <Icon
                        name={attribute === undefined ? 'circle-question-mark' : iconOf(attribute)}
                        size="sm"
                        tone="muted"
                      />
                      <Path parts={[name]} />
                    </span>
                    <span className={styles.direction}>{directionLabel(rule.direction)}</span>
                  </>
                ) : (
                  <>
                    <span className={styles.pick}>
                      <MenuTrigger>
                        <Button
                          variant="secondary"
                          icon={attribute === undefined ? 'circle-question-mark' : iconOf(attribute)}
                          iconRight="chevron-down"
                          isFullWidth
                          tooltipWhenCut
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
                    </span>
                    <span className={styles.pick}>
                      <MenuTrigger>
                        <Button
                          variant="secondary"
                          icon={rule.direction === 'ascending' ? 'arrow-up-narrow-wide' : 'arrow-down-wide-narrow'}
                          iconRight="chevron-down"
                          isFullWidth
                        >
                          {directionLabel(rule.direction)}
                        </Button>
                        <Menu
                          label={strings.direction(name)}
                          selectionMode="single"
                          selectedKeys={[rule.direction]}
                          onAction={(key: MenuKey) => {
                            if (key === 'ascending' || key === 'descending') replace({ ...rule, direction: key });
                          }}
                        >
                          {DIRECTIONS.map((each) => (
                            <MenuItem key={each.id} id={each.id} icon={each.icon}>
                              {directionLabel(each.id)}
                            </MenuItem>
                          ))}
                        </Menu>
                      </MenuTrigger>
                    </span>
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
      </SortableList>
      {adder}
    </div>
  );
}

/** A direction in words: "Ascending", "Descending". */
const directionLabel = (direction: 'ascending' | 'descending') =>
  direction === 'ascending' ? strings.ascending : strings.descending;

/** A searchable menu of attributes, each with its type's icon: the object's own first, system fields after under System. */
function AttributeMenu({
  attributes,
  onAction,
}: {
  readonly attributes: readonly FieldAttribute[];
  readonly onAction: (key: MenuKey) => void;
}) {
  const item = (attribute: FieldAttribute) => (
    <MenuItem key={attribute.id} id={attribute.id} icon={iconOf(attribute)}>
      {attribute.name}
    </MenuItem>
  );
  const own = attributes.filter((attribute) => attribute.isSystem !== true);
  const system = attributes.filter((attribute) => attribute.isSystem === true);
  return (
    <Menu label={strings.attributes} search={{ label: strings.searchAttributes }} onAction={onAction}>
      {own.map(item)}
      {system.length > 0 && (
        <MenuSection label={strings.system} isLabelHidden={own.length === 0}>
          {system.map(item)}
        </MenuSection>
      )}
    </Menu>
  );
}
