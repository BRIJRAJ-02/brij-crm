// The advanced filter (spec 0003, filter conditions): rows of conditions
// joined by and or or, groups nested up to three deep, paths through
// relations (Company › Country), and each operand edited through the field
// set. It holds a FilterGroup from contracts and hands back every change.
import type { AttributeType, FilterGroup, FilterOperator, RelativeRange } from '@crm/contracts/values';
import { createContext, useContext, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { Button } from '../../atoms/Button/Button.tsx';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import type { IconName } from '../../atoms/Icon/icons.ts';
import { Path } from '../../atoms/Path/Path.tsx';
import { AttributeDisplay } from '../../fields/AttributeDisplay.tsx';
import { AttributeEditor } from '../../fields/AttributeEditor.tsx';
import { strings as interactionStrings } from '../../fields/Interaction/strings.ts';
import { CountryPicker } from '../../fields/Location/CountryPicker.tsx';
import { fieldTypeOf, isSystemOnly } from '../../fields/registry.ts';
import { strings as fieldStrings } from '../../fields/strings.ts';
import type { EditorProps, FieldAttribute } from '../../fields/types.ts';
import { EmptyState } from '../../molecules/EmptyState/EmptyState.tsx';
import { Field } from '../../molecules/Field/Field.tsx';
import { Menu, MenuItem, MenuTrigger, SubmenuTrigger, type MenuKey } from '../../molecules/Menu/Menu.tsx';
import { Select } from '../../molecules/Select/Select.tsx';
import { focusLater } from '../../lib/focus-later.ts';
import { memoIntl } from '../../lib/intl-memo.ts';
import { useFormatSettings } from '../../provider/context.ts';
import styles from './FilterBuilder.module.css';
import {
  addItem,
  canNest,
  conditionOn,
  isGroup,
  leafOf,
  operandOf,
  operatorsFor,
  removeItem,
  setConjunction,
  throughPath,
  updateItem,
  type FilterItem,
  type ItemPath,
  type LeafCondition,
} from './filter-model.ts';
import { strings } from './strings.ts';

// A relation and the attribute on its far side, as one menu key.
const SEPARATOR = '\u0000';
const NAMED = ['today', 'this_week', 'this_month', 'last_month'] as const;
const DEFAULT_AMOUNT = { amount: 7, unit: 'day' } as const;
const MIN_AMOUNT = 1;
const MAX_AMOUNT = 999;

/** Where focus goes after a row comes or goes: a row (its operator, or its attribute), or a group's Add filter. */
type FocusTarget = { readonly row: ItemPath; readonly part: 'operator' | 'attribute' } | { readonly adder: ItemPath };

/**
 * Adding or removing rows: the change, and where focus goes once it lands.
 * Rows are keyed by place, so each such change also starts a new generation of
 * keys, and no row keeps the state of the row that was there before.
 */
interface Structure {
  readonly generation: number;
  readonly change: (next: FilterGroup, focus: FocusTarget) => void;
}

const StructureContext = createContext<Structure | undefined>(undefined);

function useStructure(): Structure {
  const structure = useContext(StructureContext);
  if (structure === undefined) throw new Error('A filter row renders only inside FilterBuilder.');
  return structure;
}

const pathKey = (path: ItemPath) => path.join('.');

/** What an operand's editor needs from the screen: member and record search, and the signed in member. */
export type FilterEditorProps = Pick<EditorProps<AttributeType>, 'onSearch' | 'me'>;

/** Props for FilterBuilder. */
export interface FilterBuilderProps {
  /** The view's object's attributes. */
  readonly attributes: readonly FieldAttribute[];
  /** The attributes on a relation's far side, so a condition can go through it: Company › Country. */
  readonly relatedAttributes?: (relation: FieldAttribute) => readonly FieldAttribute[] | undefined;
  readonly value: FilterGroup;
  /** Every change, conditions still missing their operand included; save `completeFilters(value)`. */
  readonly onChange: (next: FilterGroup) => void;
  /** What a reference operand's editor needs: search, and the signed in member. */
  readonly editorProps?: (attribute: FieldAttribute) => FilterEditorProps;
  /** The display shapes for an operand (record and member names), from the data layer. */
  readonly displayOf?: (attributeId: string, value: unknown) => unknown;
  /** Shows the filters as sentences, with nothing to change: a view you can't edit. */
  readonly isReadOnly?: boolean;
}

interface Resolved {
  readonly attribute: FieldAttribute;
  /** The names along the path, the attribute's last: ['Company', 'Country']. */
  readonly names: readonly string[];
}

/** The attribute at the end of `path` (relation ids), named along the way. */
function resolve(props: FilterBuilderProps, path: readonly string[], attributeId: string): Resolved | undefined {
  let list = props.attributes;
  const names: string[] = [];
  for (const id of path) {
    const relation = list.find((each) => each.id === id);
    if (relation === undefined) return undefined;
    names.push(relation.name);
    list = props.relatedAttributes?.(relation) ?? [];
  }
  const attribute = list.find((each) => each.id === attributeId);
  return attribute === undefined ? undefined : { attribute, names: [...names, attribute.name] };
}

/** An operand's attribute: editable, never required, one value, and a system time as a date. */
function operandAttribute(attribute: FieldAttribute): FieldAttribute {
  return {
    id: attribute.id,
    name: attribute.name,
    type: isSystemOnly(attribute.type) ? 'date' : attribute.type,
    allowMultiple: false,
    isRequired: false,
    isUnique: false,
    isReadOnly: false,
    ...(attribute.options === undefined ? {} : { options: attribute.options }),
    ...(attribute.defaultCurrency === undefined ? {} : { defaultCurrency: attribute.defaultCurrency }),
    ...(attribute.defaultCountry === undefined ? {} : { defaultCountry: attribute.defaultCountry }),
    ...(attribute.cardinality === undefined ? {} : { cardinality: attribute.cardinality }),
  };
}

/** A list operand's attribute: several values, a status's statuses as a multi select. */
function listAttribute(attribute: FieldAttribute): FieldAttribute {
  const one = operandAttribute(attribute);
  return {
    ...one,
    ...(attribute.type === 'status' ? { type: 'select' as const } : {}),
    allowMultiple: true,
    ...(attribute.type === 'record_reference' ? { cardinality: 'many' as const } : {}),
  };
}

/**
 * The advanced filter: "Where" then rows of conditions, the second row
 * choosing and or or for its group, groups nested up to three deep, and paths
 * through relations. Operands edit through the field set on its filter
 * surface. Narrow slots stack each row's lead above its controls.
 */
export function FilterBuilder(props: FilterBuilderProps) {
  const { value, onChange, isReadOnly = false } = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const [generation, setGeneration] = useState(0);
  const focusNext = useRef<FocusTarget | undefined>(undefined);
  useEffect(() => {
    const target = focusNext.current;
    const root = rootRef.current;
    if (target === undefined || root === null) return;
    focusNext.current = undefined;
    focusLater(() => {
      const triggers = (element: Element | null | undefined) =>
        element === null || element === undefined
          ? []
          : [...element.querySelectorAll<HTMLElement>(':scope > [data-cells] button[aria-haspopup]')];
      let button: HTMLElement | undefined;
      if ('row' in target) {
        const row = root.querySelector(`[data-filter-path="${pathKey(target.row)}"]`);
        const found = triggers(row);
        // A group in that place: its first control.
        button =
          (target.part === 'operator' ? (found[1] ?? found[0]) : found[0]) ??
          row?.querySelector<HTMLElement>('button') ??
          undefined;
      } else {
        button = root.querySelector<HTMLElement>(`[data-filter-adder="${pathKey(target.adder)}"] button`) ?? undefined;
      }
      return button ?? root.querySelector<HTMLElement>('button');
    });
  });
  const structure: Structure = {
    generation,
    change: (next, focus) => {
      focusNext.current = focus;
      setGeneration((previous) => previous + 1);
      onChange(next);
    },
  };
  if (value.conditions.length === 0) {
    return (
      <div ref={rootRef} className={styles.root} data-filter-adder="">
        <EmptyState
          title={strings.noFilters}
          icon="list-filter"
          {...(isReadOnly
            ? {}
            : {
                actions: (
                  <AttributeTrigger
                    builder={props}
                    label={strings.addFilter}
                    onPick={(path, attribute) => {
                      structure.change(addItem(value, [], throughPath(path, conditionOn(attribute))), {
                        row: [0],
                        part: 'operator',
                      });
                    }}
                  />
                ),
              })}
        >
          {isReadOnly ? undefined : strings.noFiltersText}
        </EmptyState>
      </div>
    );
  }
  return (
    <StructureContext.Provider value={structure}>
      <div ref={rootRef} className={styles.root} role="group" aria-label={strings.label}>
        <GroupRows builder={props} group={value} path={[]} />
      </div>
    </StructureContext.Provider>
  );
}

/** How many items the group at `path` holds. */
function groupSize(root: FilterGroup, path: ItemPath): number {
  let group: FilterGroup = root;
  for (const index of path) {
    const item = group.conditions[index];
    if (item === undefined || !isGroup(item)) return 0;
    group = item;
  }
  return group.conditions.length;
}

/**
 * Where focus goes once the item at `path` is gone: the row that takes its
 * place, else the one before, else its group's Add filter (or, once nothing
 * is left, the empty state's).
 */
function afterRemoving(path: ItemPath, siblings: number): FocusTarget {
  const parent = path.slice(0, -1);
  const index = path.at(-1) ?? 0;
  if (index < siblings - 1) return { row: [...parent, index], part: 'attribute' };
  if (index > 0) return { row: [...parent, index - 1], part: 'attribute' };
  return { adder: parent.length === 0 ? [] : parent };
}

interface GroupRowsProps {
  readonly builder: FilterBuilderProps;
  readonly group: FilterGroup;
  readonly path: ItemPath;
}

/** A group's rows, then its Add buttons. */
function GroupRows({ builder, group, path }: GroupRowsProps) {
  const { value, onChange, isReadOnly = false } = builder;
  const structure = useStructure();
  const end = group.conditions.length;
  const lead = (index: number): ReactNode => {
    if (index === 0) return strings.where;
    if (index > 1 || isReadOnly) return strings.conjunctions[group.conjunction];
    return (
      <Select
        label={strings.conjunction}
        isLabelHidden
        size="sm"
        value={group.conjunction}
        items={[
          { id: 'and', label: strings.conjunctions.and },
          { id: 'or', label: strings.conjunctions.or },
        ]}
        onChange={(next) => {
          if (next === 'and' || next === 'or') onChange(setConjunction(value, path, next));
        }}
      />
    );
  };
  return (
    <>
      <div className={styles.rows}>
        {group.conditions.map((item, index) => {
          const itemPath = [...path, index];
          return (
            <div
              key={`${String(structure.generation)}:${String(index)}`}
              className={styles.row}
              data-filter-path={pathKey(itemPath)}
            >
              <span className={styles.lead}>{lead(index)}</span>
              {isGroup(item) ? (
                <div className={styles.group} role="group" aria-label={strings.group(index + 1)}>
                  <GroupRows builder={builder} group={item} path={itemPath} />
                </div>
              ) : (
                <ConditionRow builder={builder} item={item} path={itemPath} index={index} />
              )}
            </div>
          );
        })}
      </div>
      {!isReadOnly && (
        <div className={styles.foot} data-filter-adder={pathKey(path)}>
          <AttributeTrigger
            builder={builder}
            label={strings.addFilter}
            onPick={(relationPath, attribute) => {
              structure.change(addItem(value, path, throughPath(relationPath, conditionOn(attribute))), {
                row: [...path, end],
                part: 'operator',
              });
            }}
          />
          {canNest(path) && (
            <AttributeTrigger
              builder={builder}
              label={strings.addGroup}
              onPick={(relationPath, attribute) => {
                structure.change(
                  addItem(value, path, {
                    conjunction: 'and',
                    conditions: [throughPath(relationPath, conditionOn(attribute))],
                  }),
                  { row: [...path, end, 0], part: 'operator' },
                );
              }}
            />
          )}
          {path.length > 0 && (
            <Button
              variant="ghost"
              icon="trash"
              onPress={() => {
                structure.change(removeItem(value, path), afterRemoving(path, groupSize(value, path.slice(0, -1))));
              }}
            >
              {strings.removeGroup}
            </Button>
          )}
        </div>
      )}
    </>
  );
}

interface ConditionRowProps {
  readonly builder: FilterBuilderProps;
  readonly item: FilterItem;
  readonly path: ItemPath;
  readonly index: number;
}

/** One condition: its attribute (through relations), its operator, its operand, and Remove. */
function ConditionRow({ builder, item, path, index }: ConditionRowProps) {
  const { value, onChange, isReadOnly = false } = builder;
  const structure = useStructure();
  if (isGroup(item)) return null;
  const { path: relations, leaf } = leafOf(item);
  const resolved = resolve(builder, relations, leaf.attributeId);
  const replace = (next: LeafCondition) => {
    onChange(updateItem(value, path, () => throughPath(relations, next)));
  };
  const operatorLabel = fieldStrings.operators[leaf.operator];
  const icon: IconName = resolved === undefined ? 'circle-question-mark' : fieldTypeOf(resolved.attribute.type).icon;
  const names = resolved?.names ?? [leaf.attributeId];
  if (isReadOnly) {
    return (
      <div className={styles.cells} role="group" aria-label={strings.condition(index + 1)}>
        <span className={styles.attribute}>
          <Icon name={icon} size="sm" tone="muted" />
          <Path parts={names} />
        </span>
        <span className={styles.operator}>{operatorLabel}</span>
        {resolved !== undefined && <OperandDisplay builder={builder} attribute={resolved.attribute} leaf={leaf} />}
      </div>
    );
  }
  return (
    <div className={styles.cells} role="group" aria-label={strings.condition(index + 1)} data-cells="">
      <AttributeTrigger
        builder={builder}
        current={{ icon, names }}
        onPick={(nextPath, attribute) => {
          onChange(updateItem(value, path, () => throughPath(nextPath, conditionOn(attribute))));
        }}
      />
      {resolved !== undefined && (
        <MenuTrigger>
          <Button variant="secondary" iconRight="chevron-down">
            {operatorLabel}
          </Button>
          <Menu
            label={strings.operators}
            selectionMode="single"
            selectedKeys={[leaf.operator]}
            onAction={(key: MenuKey) => {
              replace(conditionOn(resolved.attribute, String(key) as FilterOperator));
            }}
          >
            {operatorsFor(resolved.attribute).map((each) => (
              <MenuItem key={each.operator} id={each.operator}>
                {fieldStrings.operators[each.operator]}
              </MenuItem>
            ))}
          </Menu>
        </MenuTrigger>
      )}
      {resolved !== undefined && (
        <OperandEditor builder={builder} attribute={resolved.attribute} leaf={leaf} onChange={replace} />
      )}
      <Button
        variant="ghost"
        icon="x"
        label={strings.removeFilter}
        onPress={() => {
          structure.change(removeItem(value, path), afterRemoving(path, groupSize(value, path.slice(0, -1))));
        }}
      />
    </div>
  );
}

interface OperandProps {
  readonly builder: FilterBuilderProps;
  readonly attribute: FieldAttribute;
  readonly leaf: LeafCondition;
}

/** The operand's editor, by how the operator takes it. */
function OperandEditor({
  builder,
  attribute,
  leaf,
  onChange,
}: OperandProps & { readonly onChange: (next: LeafCondition) => void }) {
  const kind = operandOf(attribute, leaf.operator);
  const extra = builder.editorProps?.(attribute) ?? {};
  const displayOf = (operand: unknown) => builder.displayOf?.(attribute.id, operand);
  const editor = (target: FieldAttribute, current: unknown, label: string, commit: (next: unknown) => void) => {
    const display = displayOf(current);
    return (
      <span className={styles.operand}>
        <AttributeEditor
          attribute={{ ...target, name: label }}
          value={current ?? null}
          surface="filter"
          onCommit={commit}
          {...extra}
          {...(display === undefined ? {} : { display: display as never })}
        />
      </span>
    );
  };
  if (kind === 'none') return null;
  if (leaf.operator === 'country_is' && 'value' in leaf) {
    return (
      <CountryPicker
        label={strings.value(attribute.name)}
        isLabelHidden
        size="sm"
        value={typeof leaf.value === 'string' ? leaf.value : null}
        onChange={(code) => {
          onChange({ ...leaf, value: code ?? undefined });
        }}
      />
    );
  }
  if (leaf.operator === 'kind_is' && 'value' in leaf) {
    return (
      <Select
        label={strings.value(attribute.name)}
        isLabelHidden
        size="sm"
        value={typeof leaf.value === 'string' ? leaf.value : null}
        items={[
          { id: 'email', label: interactionStrings.email },
          { id: 'meeting', label: interactionStrings.meeting },
        ]}
        onChange={(next) => {
          onChange({ ...leaf, value: next ?? undefined });
        }}
      />
    );
  }
  if (kind === 'text' && 'value' in leaf) {
    return (
      <Field
        label={strings.value(attribute.name)}
        isLabelHidden
        size="sm"
        value={typeof leaf.value === 'string' ? leaf.value : ''}
        onChange={(next) => {
          onChange({ ...leaf, value: next });
        }}
      />
    );
  }
  if (kind === 'range' && 'from' in leaf) {
    const one = operandAttribute(attribute);
    return (
      <span className={styles.range}>
        {editor(one, leaf.from, strings.from(attribute.name), (next) => {
          onChange({ ...leaf, from: next ?? undefined });
        })}
        <span className={styles.lead}>{strings.between}</span>
        {editor(one, leaf.to, strings.to(attribute.name), (next) => {
          onChange({ ...leaf, to: next ?? undefined });
        })}
      </span>
    );
  }
  if (kind === 'list' && 'values' in leaf) {
    return editor(listAttribute(attribute), leaf.values, strings.value(attribute.name), (next) => {
      onChange({ ...leaf, values: Array.isArray(next) ? next : next === null ? [] : [next] });
    });
  }
  if (kind === 'relative' && 'range' in leaf) {
    return (
      <RangeEditor
        name={attribute.name}
        operator={leaf.operator}
        range={leaf.range}
        onChange={(range) => {
          onChange({ ...leaf, range });
        }}
      />
    );
  }
  if ('value' in leaf) {
    return editor(operandAttribute(attribute), leaf.value, strings.value(attribute.name), (next) => {
      onChange({ ...leaf, value: next ?? undefined });
    });
  }
  return null;
}

/** A read only operand, through the field set's display. */
function OperandDisplay({ builder, attribute, leaf }: OperandProps) {
  const shown = (operand: unknown, target: FieldAttribute) => {
    const display = builder.displayOf?.(attribute.id, operand);
    return (
      <AttributeDisplay
        attribute={target}
        value={operand ?? null}
        surface="filter"
        {...(display === undefined ? {} : { display: display as never })}
      />
    );
  };
  if ('from' in leaf) {
    return (
      <span className={styles.range}>
        {shown(leaf.from, operandAttribute(attribute))}
        <span className={styles.lead}>{strings.between}</span>
        {shown(leaf.to, operandAttribute(attribute))}
      </span>
    );
  }
  if ('values' in leaf) return shown(leaf.values, listAttribute(attribute));
  if ('range' in leaf) return <RangeText range={leaf.range} />;
  if ('value' in leaf) return shown(leaf.value, operandAttribute(attribute));
  return null;
}

/** A relative range as words: "this week", or "7 days" with the number in the provider's language. */
function RangeText({ range }: { readonly range: RelativeRange }) {
  const { locale } = useFormatSettings();
  const text =
    typeof range === 'string'
      ? strings.ranges[range]
      : strings.lastAmount(
          memoIntl(`plain:${locale}`, () => new Intl.NumberFormat(locale)).format(range.amount),
          strings.units[range.unit],
        );
  return <span className={styles.operator}>{text}</span>;
}

/** How many days, weeks, months or years: typed freely, checked and committed on leaving. */
function AmountField({
  label,
  amount,
  onCommit,
}: {
  readonly label: string;
  readonly amount: number;
  readonly onCommit: (amount: number) => void;
}) {
  const [draft, setDraft] = useState(String(amount));
  const [error, setError] = useState<string | undefined>(undefined);
  const commit = () => {
    const next = Number(draft.trim());
    if (!Number.isInteger(next) || next < MIN_AMOUNT || next > MAX_AMOUNT) {
      setError(strings.amountRange);
      return;
    }
    setError(undefined);
    if (next !== amount) onCommit(next);
  };
  return (
    <Field
      label={label}
      isLabelHidden
      size="sm"
      inputMode="numeric"
      isErrorFloating
      value={draft}
      onChange={(text) => {
        setDraft(text);
        setError(undefined);
      }}
      onBlur={commit}
      onSubmit={commit}
      {...(error === undefined ? {} : { error })}
    />
  );
}

/** "Within" takes a named range (this week); "within the last" an amount of days, weeks, months or years. */
function RangeEditor({
  name,
  operator,
  range,
  onChange,
}: {
  readonly name: string;
  readonly operator: 'within' | 'within_last';
  readonly range: RelativeRange;
  readonly onChange: (range: RelativeRange) => void;
}): ReactElement {
  if (operator === 'within') {
    return (
      <Select
        label={strings.range(name)}
        isLabelHidden
        size="sm"
        value={typeof range === 'string' ? range : null}
        placeholder={strings.chooseRange}
        items={NAMED.map((id) => ({ id, label: strings.ranges[id] }))}
        onChange={(next) => {
          const named = NAMED.find((each) => each === next);
          if (named !== undefined) onChange(named);
        }}
      />
    );
  }
  const amount = typeof range === 'string' ? DEFAULT_AMOUNT : range;
  return (
    <span className={styles.range}>
      <span className={styles.amount}>
        <AmountField
          label={strings.amount(name)}
          amount={amount.amount}
          onCommit={(next) => {
            onChange({ ...amount, amount: next });
          }}
        />
      </span>
      <Select
        label={strings.unit(name)}
        isLabelHidden
        size="sm"
        value={amount.unit}
        items={(['day', 'week', 'month', 'year'] as const).map((id) => ({ id, label: strings.units[id] }))}
        onChange={(next) => {
          if (next === 'day' || next === 'week' || next === 'month' || next === 'year') {
            onChange({ ...amount, unit: next });
          }
        }}
      />
    </span>
  );
}

interface AttributeTriggerProps {
  readonly builder: FilterBuilderProps;
  /** What the row filters on now; without it the trigger is an Add button with `label`. */
  readonly current?: { readonly icon: IconName; readonly names: readonly string[] };
  readonly label?: string;
  readonly onPick: (path: readonly string[], attribute: FieldAttribute) => void;
}

/** The attribute picker: the object's attributes, with relations opening their own as a submenu. */
function AttributeTrigger({ builder, current, label, onPick }: AttributeTriggerProps) {
  const pick = (key: MenuKey) => {
    const [relationId, attributeId] = String(key).split(SEPARATOR);
    if (attributeId === undefined) {
      const attribute = builder.attributes.find((each) => each.id === relationId);
      if (attribute !== undefined) onPick([], attribute);
      return;
    }
    const relation = builder.attributes.find((each) => each.id === relationId);
    const attribute =
      relation === undefined
        ? undefined
        : builder.relatedAttributes?.(relation)?.find((each) => each.id === attributeId);
    if (relation !== undefined && attribute !== undefined) onPick([relation.id], attribute);
  };
  const trigger =
    current === undefined ? (
      <Button variant="dashed" icon="plus">
        {label ?? strings.addFilter}
      </Button>
    ) : (
      <Button variant="secondary" icon={current.icon} iconRight="chevron-down">
        {current.names.join(strings.pathJoin)}
      </Button>
    );
  return (
    <MenuTrigger>
      {trigger}
      <Menu label={strings.attributes} search={{ label: strings.searchAttributes }} onAction={pick}>
        {builder.attributes.map((attribute) => {
          const related = builder.relatedAttributes?.(attribute);
          const item = (
            <MenuItem key={attribute.id} id={attribute.id} icon={fieldTypeOf(attribute.type).icon}>
              {attribute.name}
            </MenuItem>
          );
          if (related === undefined || related.length === 0) return item;
          return (
            <SubmenuTrigger key={attribute.id}>
              {[
                item,
                <Menu key="related" label={attribute.name} onAction={pick}>
                  {related.map((each) => (
                    <MenuItem
                      key={each.id}
                      id={`${attribute.id}${SEPARATOR}${each.id}`}
                      icon={fieldTypeOf(each.type).icon}
                    >
                      {each.name}
                    </MenuItem>
                  ))}
                </Menu>,
              ]}
            </SubmenuTrigger>
          );
        })}
      </Menu>
    </MenuTrigger>
  );
}
