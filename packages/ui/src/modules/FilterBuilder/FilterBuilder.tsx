// The advanced filter (spec 0003, filter conditions): rows of conditions
// joined by and or or, groups nested up to three deep, paths through
// relations (Company › Country), and each operand edited through the field
// set. It holds a FilterGroup from contracts and hands back every change.
import type { AttributeType, FilterCondition, FilterGroup, FilterOperator, RelativeRange } from '@crm/contracts/values';
import { createContext, useContext, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { Button } from '../../atoms/Button/Button.tsx';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import type { IconName } from '../../atoms/Icon/icons.ts';
import { Path } from '../../atoms/Path/Path.tsx';
import { AttributeDisplay } from '../../fields/AttributeDisplay.tsx';
import { AttributeEditor } from '../../fields/AttributeEditor.tsx';
import { strings as interactionStrings } from '../../fields/Interaction/strings.ts';
import { CountryPicker } from '../../molecules/CountryPicker/CountryPicker.tsx';
import { iconOf, isSystemOnly } from '../../fields/registry.ts';
import { strings as fieldStrings } from '../../fields/strings.ts';
import type { EditorProps, FieldAttribute } from '../../fields/types.ts';
import { EmptyState } from '../../molecules/EmptyState/EmptyState.tsx';
import { FilterChip } from '../../molecules/FilterChip/FilterChip.tsx';
import { Field } from '../../molecules/Field/Field.tsx';
import { Menu, MenuItem, MenuSection, MenuTrigger, SubmenuTrigger, type MenuKey } from '../../molecules/Menu/Menu.tsx';
import { Select } from '../../molecules/Select/SelectWithFaces.tsx';
import { focusLater } from '../../lib/focus-later.ts';
import { memoIntl } from '../../lib/intl-memo.ts';
import { useFormatSettings } from '../../provider/context.ts';
import styles from './FilterBuilder.module.css';
import {
  addItem,
  canNest,
  conditionOn,
  countFilters,
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
  /**
   * Narrows an attribute's operators to these, in its type's order (undefined keeps them all): a relationship
   * offers only is empty and is not empty where the screen has no record search for its operand.
   */
  readonly operatorsOf?: (attribute: FieldAttribute) => readonly FilterOperator[] | undefined;
}

/** The operators the builder offers on `attribute`: its type's, narrowed by `operatorsOf`. */
function operatorsIn(builder: FilterBuilderProps, attribute: FieldAttribute) {
  const all = operatorsFor(attribute);
  const only = builder.operatorsOf?.(attribute);
  return only === undefined ? all : all.filter((each) => only.includes(each.operator));
}

/** A new condition on `attribute`, starting on the first operator the builder offers. */
function startOn(builder: FilterBuilderProps, attribute: FieldAttribute): LeafCondition {
  return conditionOn(attribute, operatorsIn(builder, attribute)[0]?.operator);
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
    // A moment is compared by its day (before, after): its operand is a date, as the engine reads one.
    type: isSystemOnly(attribute.type) || attribute.type === 'timestamp' ? 'date' : attribute.type,
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
    // One quiet line, then Add filter: no tile or paragraph in a small popover (owner, less text, 31 October 2026).
    return (
      <div ref={rootRef} className={styles.root} data-filter-adder="">
        <EmptyState title={strings.noFilters} icon="list-filter" layout="row" />
        {!isReadOnly && (
          <span className={styles.foot}>
            <AttributeTrigger
              builder={props}
              label={strings.addFilter}
              onPick={(path, attribute) => {
                structure.change(addItem(value, [], throughPath(path, startOn(props, attribute))), {
                  row: [0],
                  part: 'operator',
                });
              }}
            />
          </span>
        )}
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
              structure.change(addItem(value, path, throughPath(relationPath, startOn(builder, attribute))), {
                row: [...path, end],
                part: 'operator',
              });
            }}
          />
          {canNest(path) && (
            <AttributeTrigger
              builder={builder}
              label={strings.addGroup}
              addIcon="list-plus"
              onPick={(relationPath, attribute) => {
                structure.change(
                  addItem(value, path, {
                    conjunction: 'and',
                    conditions: [throughPath(relationPath, startOn(builder, attribute))],
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
          {/* The top group's foot ends with Clear all, on the same row as Add filter, as Attio's does: only while
              there is something to clear. */}
          {path.length === 0 && value.conditions.length > 0 && (
            <span className={styles.clearAll}>
              <Button
                variant="ghost"
                icon="x"
                onPress={() => {
                  structure.change({ ...value, conditions: [] }, { adder: [] });
                }}
              >
                {strings.clearAll}
              </Button>
            </span>
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
  const pickVariant = usePickVariant();
  if (isGroup(item)) return null;
  const { path: relations, leaf } = leafOf(item);
  const resolved = resolve(builder, relations, leaf.attributeId);
  const replace = (next: LeafCondition) => {
    onChange(updateItem(value, path, () => throughPath(relations, next)));
  };
  const operatorLabel = fieldStrings.operators[leaf.operator];
  const icon: IconName = resolved === undefined ? 'circle-question-mark' : iconOf(resolved.attribute);
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
          onChange(updateItem(value, path, () => throughPath(nextPath, startOn(builder, attribute))));
        }}
      />
      {resolved !== undefined && (
        <span className={styles.operatorPick}>
          <MenuTrigger>
            <Button variant={pickVariant} iconRight="chevron-down" isFullWidth>
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
              {operatorsIn(builder, resolved.attribute).map((each) => (
                <MenuItem key={each.operator} id={each.operator}>
                  {fieldStrings.operators[each.operator]}
                </MenuItem>
              ))}
            </Menu>
          </MenuTrigger>
        </span>
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
        list="all"
        isClearable
        placeholder={strings.chooseCountry}
        searchLabel={strings.searchCountries}
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
  if ('range' in leaf) return <RangeText range={leaf.range} isAgo={leaf.operator === 'more_than_ago'} />;
  // A country is a code, and a text match is the words typed: neither is a value of the attribute's own type.
  if (leaf.operator === 'country_is' && typeof leaf.value === 'string') return <CountryText code={leaf.value} />;
  if ('value' in leaf && operandOf(attribute, leaf.operator) === 'text' && typeof leaf.value === 'string') {
    return <span className={styles.operator}>{leaf.value}</span>;
  }
  if ('value' in leaf) return shown(leaf.value, operandAttribute(attribute));
  return null;
}

/** A country code as its name in the provider's language: "United Kingdom". */
function CountryText({ code }: { readonly code: string }) {
  const { locale } = useFormatSettings();
  const name = memoIntl(`region:${locale}`, () => new Intl.DisplayNames(locale, { type: 'region' })).of(code) ?? code;
  return <span className={styles.operator}>{name}</span>;
}

/** A relative range as words: "this week", or "7 days" with the number in the provider's language. */
function RangeText({ range, isAgo }: { readonly range: RelativeRange; readonly isAgo: boolean }) {
  const { locale } = useFormatSettings();
  const text =
    typeof range === 'string'
      ? strings.ranges[range]
      : (isAgo ? strings.agoAmount : strings.lastAmount)(
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

/**
 * "Within" takes a named range (this week); "within the last", "within the next" and "is more than … ago" an amount
 * of days, weeks, months or years.
 */
function RangeEditor({
  name,
  operator,
  range,
  onChange,
}: {
  readonly name: string;
  readonly operator: 'within' | 'within_last' | 'within_next' | 'more_than_ago';
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
      {operator === 'more_than_ago' && <span className={styles.lead}>{strings.ago}</span>}
    </span>
  );
}

interface AttributeTriggerProps {
  readonly builder: FilterBuilderProps;
  /** What the row filters on now; without it the trigger is an Add button with `label`. */
  readonly current?: { readonly icon: IconName; readonly names: readonly string[] };
  readonly label?: string;
  /** The Add button's icon: a plus for Add filter, the list's for Add group (the quieter, second choice). */
  readonly addIcon?: IconName;
  readonly onPick: (path: readonly string[], attribute: FieldAttribute) => void;
}

/** The attribute picker: the object's attributes, with relations opening their own as a submenu. */
/**
 * A condition's pickers always carry the secondary edge and fill, in a popover too: borderless pickers read as
 * plain text, not dropdowns (owner item 44, 31 October 2026; they were ghost in a popover until then).
 */
function usePickVariant(): 'secondary' {
  return 'secondary';
}

function AttributeTrigger({ builder, current, label, addIcon = 'plus', onPick }: AttributeTriggerProps) {
  const pickVariant = usePickVariant();
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
      // Quiet: an add never outweighs the conditions it adds to (owner items 43 and 48).
      <Button variant="ghost" icon={addIcon}>
        {label ?? strings.addFilter}
      </Button>
    ) : (
      <Button variant={pickVariant} icon={current.icon} iconRight="chevron-down" isFullWidth tooltipWhenCut>
        {current.names.join(strings.pathJoin)}
      </Button>
    );
  // The object's own attributes first; system ones (Record ID, Created at) after, under System: nobody starts there.
  const own = builder.attributes.filter((attribute) => attribute.isSystem !== true);
  const system = builder.attributes.filter((attribute) => attribute.isSystem === true);
  const entry = (attribute: FieldAttribute) => {
    const related = builder.relatedAttributes?.(attribute);
    const item = (
      <MenuItem key={attribute.id} id={attribute.id} icon={iconOf(attribute)}>
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
              <MenuItem key={each.id} id={`${attribute.id}${SEPARATOR}${each.id}`} icon={iconOf(each)}>
                {each.name}
              </MenuItem>
            ))}
          </Menu>,
        ]}
      </SubmenuTrigger>
    );
  };
  const menuTrigger = (
    <MenuTrigger>
      {trigger}
      <Menu label={strings.attributes} search={{ label: strings.searchAttributes }} onAction={pick}>
        {own.map(entry)}
        {system.length > 0 && (
          <MenuSection label={strings.system} isLabelHidden={own.length === 0}>
            {system.map(entry)}
          </MenuSection>
        )}
      </Menu>
    </MenuTrigger>
  );
  // A condition's attribute sits at a fixed width, as SortBuilder's does, so the rows line up; Add filter keeps its own.
  return current === undefined ? menuTrigger : <span className={styles.pick}>{menuTrigger}</span>;
}

/** Props for ConditionChip. */
export interface ConditionChipProps {
  /** One top level item of a view's filter: a condition, or a group of them. */
  readonly item: FilterCondition | FilterGroup;
  /** The view's object's attributes, as FilterBuilder takes them. */
  readonly attributes: readonly FieldAttribute[];
  readonly relatedAttributes?: (relation: FieldAttribute) => readonly FieldAttribute[] | undefined;
  /** The display shapes for an operand (record and member names). */
  readonly displayOf?: (attributeId: string, value: unknown) => unknown;
  /** Opens the filter builder: every part of the chip does. */
  readonly onPress?: () => void;
  readonly onRemove?: () => void;
}

const NO_FILTER: FilterGroup = { conjunction: 'and', conditions: [] };

/**
 * One applied condition of a view's filter as a FilterChip, in the builder's
 * own words (spec 0020, the Toolbar): its attribute through relations with
 * its type's icon, its operator, and its operand through the field set; a
 * condition with no operand has no value part, and a group reads "3
 * conditions". Every part opens the builder; remove takes the item away.
 */
export function ConditionChip({
  item,
  attributes,
  relatedAttributes,
  displayOf,
  onPress,
  onRemove,
}: ConditionChipProps) {
  const press =
    onPress === undefined ? {} : { onPressAttribute: onPress, onPressOperator: onPress, onPressValue: onPress };
  const removing = onRemove === undefined ? {} : { onRemove };
  if (isGroup(item)) {
    return (
      <FilterChip
        icon="list-filter"
        attribute={[strings.groupChip(countFilters(item))]}
        hasValue={false}
        {...press}
        {...removing}
      />
    );
  }
  const builder: FilterBuilderProps = {
    attributes,
    ...(relatedAttributes === undefined ? {} : { relatedAttributes }),
    ...(displayOf === undefined ? {} : { displayOf }),
    value: NO_FILTER,
    onChange: () => undefined,
  };
  const { path, leaf } = leafOf(item);
  const resolved = resolve(builder, path, leaf.attributeId);
  if (resolved === undefined) {
    return (
      <FilterChip
        icon="circle-question-mark"
        attribute={[strings.unknownAttribute]}
        hasValue={false}
        {...press}
        {...removing}
      />
    );
  }
  const takesValue = operandOf(resolved.attribute, leaf.operator) !== 'none';
  return (
    <FilterChip
      icon={iconOf(resolved.attribute)}
      attribute={resolved.names}
      operator={fieldStrings.operators[leaf.operator]}
      hasValue={takesValue}
      {...(takesValue
        ? { value: <OperandDisplay builder={builder} attribute={resolved.attribute} leaf={leaf} /> }
        : {})}
      {...press}
      {...removing}
    />
  );
}
