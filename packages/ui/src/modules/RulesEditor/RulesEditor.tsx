// RulesEditor (spec 0013, AC-252): an attribute's validation rules, in
// order. Each row reads as the message a broken rule gives (its own, or the
// generated one); it opens in place to its kind's settings, its message and
// an "Only when…" condition on the object's own attributes. Rows move by
// drag, by keyboard on the handle, or from the row's menu, which also
// deletes. Presentational: the rules come in, every change goes out as the
// whole list, and the dialog sends it with Save.
import {
  generatedMessage,
  RULE_LIMITS,
  summarizeCondition,
  type NamedAttribute,
  type RuleKindName,
} from '@crm/contracts/validation';
import {
  checkRuleSettings,
  type AttributeType,
  type ConditionAttribute,
  type FilterGroup,
} from '@crm/contracts/values';
import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { GridList, GridListItem } from 'react-aria-components';
import { Button } from '../../atoms/Button/Button.tsx';
import { Checkbox } from '../../atoms/Checkbox/Checkbox.tsx';
import { SortableList, SortableRowGrip } from '../../lib/drag/drag.tsx';
import { Radio, RadioGroup } from '../../atoms/Radio/Radio.tsx';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import type { FieldAttribute } from '../../fields/types.ts';
import { focusLater } from '../../lib/focus-later.ts';
import { reorder } from '../../lib/reorder.ts';
import { DatePicker } from '../../molecules/DatePicker/DatePicker.tsx';
import { Disclosure } from '../../molecules/Disclosure/Disclosure.tsx';
import { InfoTip } from '../../molecules/InfoTip/InfoTip.tsx';
import { Field } from '../../molecules/Field/Field.tsx';
import { Menu, MenuItem, MenuSeparator, MenuTrigger } from '../../molecules/Menu/Menu.tsx';
import { Select } from '../../molecules/Select/SelectWithFaces.tsx';
import { FilterBuilder, type FilterBuilderProps } from '../FilterBuilder/FilterBuilder.tsx';
import { newRule, ruleOf, type ListedKind, type RulesEditorRule } from './rules-model.ts';
import styles from './RulesEditor.module.css';
import { strings } from './strings.ts';

export {
  editorRuleOf,
  newRule,
  ruleOf,
  type ListedKind,
  type RuleSettings,
  type RulesEditorRule,
} from './rules-model.ts';

/** Props for RulesEditor. */
export interface RulesEditorProps {
  /** The group's name ("Rules"). */
  readonly label: string;
  /** The rules, in order. */
  readonly rules: readonly RulesEditorRule[];
  /** The kinds "Add rule" offers: those the attribute's type takes (`ruleKindsFor`). */
  readonly kinds: readonly RuleKindName[];
  /** The attribute the rules check: its title names it in each message, its type shapes the settings. */
  readonly attribute: { readonly title: string; readonly type: AttributeType };
  /**
   * The object's own attributes a condition may name (no relationship is
   * followed: FilterBuilder gets no `relatedAttributes`). Without them a
   * rule offers no "Only when…".
   */
  readonly conditionAttributes?: readonly FieldAttribute[];
  /** What a condition's reference operands need (member search, the signed in member). */
  readonly editorProps?: FilterBuilderProps['editorProps'];
  /** A new rule's id (a UUID v7 the screen mints). */
  readonly newId: () => string;
  /** Every change: the whole list, in order. */
  readonly onChange: (rules: readonly RulesEditorRule[]) => void;
  /** Refusals by `rules.<index>.<setting>`, as the server names them (and the dialog's own check). */
  readonly errors?: Readonly<Partial<Record<string, string>>>;
  /** Rules an attribute may hold: "N of 20", and Add rule stops there. */
  readonly limit?: number;
  /** Shows the rules with nothing to change (a member, a read only dialog). */
  readonly isReadOnly?: boolean;
  /** A line under the group's label: how changes are kept ("Rules wait for Save."). */
  readonly hint?: string;
}

/** The settings each kind shows, as their fields: names from the API, labels from `strings`. */
function KindFields({
  rule,
  type,
  errorOf,
  onField,
  isReadOnly,
}: {
  readonly rule: RulesEditorRule;
  readonly type: AttributeType;
  readonly errorOf: (name: string) => string | undefined;
  readonly onField: (name: string, value: string | boolean) => void;
  readonly isReadOnly: boolean;
}): ReactNode {
  const textOf = (name: string): string => {
    const value = rule.fields[name];
    return typeof value === 'string' ? value : '';
  };
  const textField = (name: string, label: string, extra: Partial<Parameters<typeof Field>[0]> = {}) => {
    const error = errorOf(name);
    return (
      <Field
        label={label}
        size="sm"
        autoComplete="off"
        value={textOf(name)}
        onChange={(value) => {
          onField(name, value);
        }}
        {...(isReadOnly ? { isReadOnly } : {})}
        {...(error === undefined ? {} : { error })}
        {...extra}
      />
    );
  };
  switch (rule.kind) {
    case 'length':
    case 'count':
    case 'range': {
      const [low, high] =
        rule.kind === 'length'
          ? [strings.atLeastCharacters, strings.atMostCharacters]
          : rule.kind === 'count'
            ? [strings.atLeastValues, strings.atMostValues]
            : [strings.smallest, strings.largest];
      const inputMode = rule.kind === 'range' && type !== 'rating' ? 'decimal' : 'numeric';
      return (
        <div className={styles.pair}>
          {textField('min', low, { inputMode })}
          {textField('max', high, { inputMode, hint: strings.boundsHint })}
        </div>
      );
    }
    case 'integer':
      return <p className={styles.note}>{strings.integerNote}</p>;
    case 'pattern': {
      const preset = textOf('preset');
      const presetError = errorOf('preset');
      return (
        <>
          <Select
            label={strings.format}
            size="sm"
            items={Object.entries(strings.presets).map(([id, label]) => ({ id, label }))}
            value={preset === '' ? null : preset}
            onChange={(next) => {
              if (next !== null) onField('preset', next);
            }}
            {...(isReadOnly ? { isReadOnly } : {})}
            {...(presetError === undefined ? {} : { error: presetError })}
          />
          {(preset === 'starts_with' || preset === 'ends_with') &&
            textField('text', strings.affixText, { maxLength: RULE_LIMITS.affix, hint: strings.affixHint })}
          {preset === 'custom' &&
            textField('regex', strings.pattern, {
              maxLength: RULE_LIMITS.pattern,
              hint: strings.patternHint,
            })}
          {/* Case matters only to text matched as typed: the letter and digit presets ignore it already. */}
          {(preset === 'starts_with' || preset === 'ends_with' || preset === 'custom') && (
            <Checkbox
              label={strings.ignoreCase}
              isSelected={rule.fields.ignoreCase === true}
              isReadOnly={isReadOnly}
              onChange={(next) => {
                onField('ignoreCase', next);
              }}
            />
          )}
        </>
      );
    }
    case 'email_domain':
      return (
        <>
          <RadioGroup
            label={strings.addresses}
            orientation="horizontal"
            value={textOf('mode') || 'allow'}
            isReadOnly={isReadOnly}
            onChange={(next) => {
              onField('mode', next);
            }}
          >
            <Radio value="allow">{strings.allowDomains}</Radio>
            <Radio value="block">{strings.blockDomains}</Radio>
          </RadioGroup>
          {textField('domains', strings.domains, { hint: strings.domainsHint })}
        </>
      );
    case 'phone_country':
      return textField('countries', strings.countries, { hint: strings.countriesHint });
    case 'currency_in':
      return textField('codes', strings.currencies, { hint: strings.currenciesHint });
    case 'date_range':
      return (
        <div className={styles.pair}>
          {(['min', 'max'] as const).map((name) => {
            const kind = textOf(`${name}Kind`) || 'none';
            const error = errorOf(name);
            const isMin = name === 'min';
            return (
              <div key={name} className={styles.bound}>
                <Select
                  label={isMin ? strings.earliest : strings.latest}
                  size="sm"
                  items={[
                    { id: 'none', label: strings.noLimit },
                    { id: 'date', label: strings.aDate },
                    { id: 'days', label: strings.daysFromToday },
                  ]}
                  value={kind}
                  onChange={(next) => {
                    if (next !== null) onField(`${name}Kind`, next);
                  }}
                  {...(isReadOnly ? { isReadOnly } : {})}
                  {...(kind === 'none' && error !== undefined ? { error } : {})}
                />
                {kind === 'date' && (
                  <DatePicker
                    label={isMin ? strings.earliestDate : strings.latestDate}
                    size="sm"
                    showQuickPicks={false}
                    value={/^\d{4}-\d{2}-\d{2}$/.test(textOf(name)) ? textOf(name) : null}
                    onChange={(value) => {
                      onField(name, value ?? '');
                    }}
                    {...(isReadOnly ? { isReadOnly } : {})}
                    {...(error === undefined ? {} : { error })}
                  />
                )}
                {kind === 'days' &&
                  textField(name, isMin ? strings.earliestDays : strings.latestDays, {
                    inputMode: 'numeric',
                    hint: strings.daysHint,
                  })}
              </div>
            );
          })}
        </div>
      );
  }
}

/**
 * RulesEditor: a React Aria GridList of an attribute's rules, each read as
 * the message it gives, opened in place (Enter, or Edit in its menu) to its
 * settings, its message and "Only when…", and moved by drag, by keyboard on
 * the handle, or Move up and Move down in its menu; "Add rule" below offers
 * the kinds the type takes. Tab moves through a row's controls.
 */
export function RulesEditor({
  label,
  rules,
  kinds,
  attribute,
  conditionAttributes,
  editorProps,
  newId,
  onChange,
  errors = {},
  limit = 20,
  isReadOnly = false,
  hint,
}: RulesEditorProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [openId, setOpenId] = useState<string | undefined>(undefined);
  const [said, setSaid] = useState('');
  // Refusals that came in since the rules were last shown open their first rule, so its field says why.
  // Compared by what they say, so a caller passing a fresh object each render settles at once.
  const errorsKey = JSON.stringify(Object.entries(errors).filter(([, message]) => message !== undefined));
  const [seenErrors, setSeenErrors] = useState('[]');
  if (seenErrors !== errorsKey) {
    setSeenErrors(errorsKey);
    const indexes = Object.keys(errors).flatMap((key) => {
      const index = errors[key] === undefined ? undefined : /^rules\.(\d+)\./.exec(key)?.[1];
      return index === undefined ? [] : [Number(index)];
    });
    const opened = indexes.length === 0 ? undefined : rules[Math.min(...indexes)];
    if (opened !== undefined) setOpenId(opened.id);
  }
  const isFull = rules.length >= limit;
  const title = attribute.title.trim() === '' ? strings.untitled : attribute.title.trim();
  const named = new Map<string, NamedAttribute>(
    (conditionAttributes ?? []).map((each) => [
      each.id,
      {
        type: each.type,
        title: each.name,
        visible: true,
        ...(each.options === undefined
          ? {}
          : { options: each.options.map((option) => ({ id: option.id, label: option.label })) }),
      },
    ]),
  );
  const settingsAttributes = new Map<string, ConditionAttribute>(
    (conditionAttributes ?? []).map((each) => [each.id, { type: each.type, isSystem: false }]),
  );

  /** What a row reads as: its own message, the message it would give, or that it isn't finished. */
  const summaryOf = (rule: RulesEditorRule): string => {
    const settings = ruleOf(rule);
    if (settings.message !== undefined) return settings.message;
    const checked = checkRuleSettings(settings, {
      attribute: { type: attribute.type, isMulti: true },
      attributes: settingsAttributes,
    });
    return checked.ok ? generatedMessage(checked.rule, title, named) : strings.unfinished;
  };
  const errorsOf = (index: number) =>
    Object.entries(errors).filter(
      ([key, message]) => message !== undefined && key.startsWith(`rules.${String(index)}.`),
    );

  const focusIn = (pick: (root: HTMLElement) => HTMLElement | null) => {
    focusLater(() => (rootRef.current === null ? null : pick(rootRef.current)));
  };
  const rowControl = (id: string, selector: string) => (root: HTMLElement) =>
    root.querySelector<HTMLElement>(`[data-key="${CSS.escape(id)}"] ${selector}`);

  const change = (id: string, next: Partial<RulesEditorRule>) => {
    onChange(rules.map((rule) => (rule.id === id ? { ...rule, ...next } : rule)));
  };
  const moveTo = (id: string, target: string, position: 'before' | 'after') => {
    const next = reorder(rules, (rule) => rule.id, new Set([id]), target, position);
    if (next === rules) return;
    onChange(next);
    setSaid(strings.moved(next.findIndex((rule) => rule.id === id) + 1, next.length));
  };
  // Enter in a setting never submits the dialog the editor sits in.
  const keepEnter = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' && event.target instanceof HTMLInputElement) event.preventDefault();
  };

  /** Opens a rule in place, focus on its first setting (or its message, for a kind with none). */
  const open = (id: string) => {
    setOpenId(id);
    focusIn(rowControl(id, 'input, textarea, button[aria-haspopup="listbox"]'));
  };

  const add = (kind: ListedKind) => {
    const rule = newRule(kind, newId());
    onChange([...rules, rule]);
    open(rule.id);
  };

  return (
    <div ref={rootRef} className={styles.root} onKeyDownCapture={keepEnter}>
      <div className={styles.head}>
        <span className={styles.title}>
          {label}{' '}
          <InfoTip label={label} example={strings.aboutRulesExample}>
            {strings.aboutRules}
          </InfoTip>
        </span>
        {!isReadOnly && rules.length > 0 && <span className={styles.usage}>{strings.usage(rules.length, limit)}</span>}
      </div>
      {hint !== undefined && !isReadOnly && <span className={styles.note}>{hint}</span>}
      {/* Editable with kinds to add, the empty list says nothing: Add rule is the next step (owner item 98). Read
          only, one line says what holds. */}
      {rules.length === 0 && (kinds.length === 0 || isReadOnly) && (
        <p className={styles.empty}>{kinds.length === 0 ? strings.noKinds : strings.noRules}</p>
      )}
      {rules.length > 0 && (
        <SortableList
          ids={rules.map((rule) => rule.id)}
          nameOf={(id) => {
            const rule = rules.find((each) => each.id === id);
            return rule === undefined ? id : strings.kinds[rule.kind];
          }}
          onMove={(move) => {
            onChange(reorder(rules, (rule) => rule.id, new Set([move.id]), move.targetId, move.position));
          }}
        >
          <GridList
            aria-label={label}
            items={rules.map((rule, index) => ({ id: rule.id, rule, index }))}
            className={styles.list}
            keyboardNavigationBehavior="tab"
            onAction={(key) => {
              if (!isReadOnly) open(String(key));
            }}
          >
            {({ id, rule, index }) => {
              const summary = summaryOf(rule);
              const kindName = strings.kinds[rule.kind];
              // A rule's own message hides its condition: a line under it says when it applies.
              const when =
                rule.message.trim() !== '' && rule.condition !== undefined && rule.condition.conditions.length > 0
                  ? strings.onlyWhenSummary(summarizeCondition(rule.condition, named))
                  : undefined;
              const isOpen = openId === id && !isReadOnly;
              const problems = errorsOf(index);
              const errorOf = (name: string) => errors[`rules.${String(index)}.${name}`];
              const kindError = errorOf('kind');
              return (
                <GridListItem
                  id={id}
                  textValue={summary}
                  className={styles.row}
                  data-open={isOpen || undefined}
                  data-pressable={isReadOnly || isOpen ? undefined : ''}
                >
                  <div className={styles.line}>
                    {!isReadOnly && (
                      <SortableRowGrip id={id} label={strings.move(index + 1, kindName)} isDisabled={isOpen} />
                    )}
                    <span className={styles.summary}>
                      <span className={styles.kind}>{kindName}</span>
                      <span className={styles.message}>{summary}</span>
                      {when !== undefined && !isOpen && <span className={styles.note}>{when}</span>}
                      {!isOpen && problems.length > 0 && (
                        <span className={styles.error} role="alert">
                          {problems[0]?.[1]}
                        </span>
                      )}
                    </span>
                    {!isReadOnly && (
                      <MenuTrigger>
                        <Button variant="ghost" icon="ellipsis" label={strings.actionsFor(index + 1, kindName)} />
                        <Menu
                          label={strings.actionsFor(index + 1, kindName)}
                          onAction={(key) => {
                            const before = rules[index - 1];
                            const after = rules[index + 1];
                            if (key === 'edit') {
                              open(id);
                              return;
                            }
                            if (key === 'up' && before !== undefined) moveTo(id, before.id, 'before');
                            else if (key === 'down' && after !== undefined) moveTo(id, after.id, 'after');
                            else if (key === 'delete') {
                              onChange(rules.filter((each) => each.id !== id));
                              setSaid(strings.deleted);
                              const next = after ?? before;
                              focusIn(
                                next === undefined
                                  ? (root) => root.querySelector<HTMLElement>('[data-adder] button')
                                  : rowControl(next.id, 'button[aria-haspopup="menu"], button[aria-haspopup="true"]'),
                              );
                              return;
                            }
                            focusIn(rowControl(id, 'button[aria-haspopup]'));
                          }}
                        >
                          <MenuItem id="edit" icon="pencil" isDisabled={isOpen}>
                            {strings.editRule}
                          </MenuItem>
                          <MenuItem id="up" icon="chevron-up" isDisabled={index === 0}>
                            {strings.moveUp}
                          </MenuItem>
                          <MenuItem id="down" icon="chevron-down" isDisabled={index === rules.length - 1}>
                            {strings.moveDown}
                          </MenuItem>
                          <MenuSeparator />
                          <MenuItem id="delete" icon="trash" isDanger>
                            {strings.delete}
                          </MenuItem>
                        </Menu>
                      </MenuTrigger>
                    )}
                  </div>
                  {isOpen && (
                    <div className={styles.form}>
                      {kindError !== undefined && (
                        <span className={styles.error} role="alert">
                          {kindError}
                        </span>
                      )}
                      <KindFields
                        rule={rule}
                        type={attribute.type}
                        errorOf={errorOf}
                        isReadOnly={isReadOnly}
                        onField={(name, value) => {
                          change(id, { fields: { ...rule.fields, [name]: value } });
                        }}
                      />
                      <Field
                        label={strings.message}
                        labelAside={strings.optional}
                        size="sm"
                        // One sentence: a line that wraps as it grows, not an empty box that looks required.
                        isWrapping
                        maxLength={RULE_LIMITS.message}
                        showCounter
                        hint={strings.messageHint}
                        value={rule.message}
                        onChange={(message) => {
                          change(id, { message });
                        }}
                        {...(errorOf('message') === undefined ? {} : { error: errorOf('message') })}
                      />
                      {conditionAttributes !== undefined && (
                        <Disclosure
                          title={strings.onlyWhen}
                          variant="fields"
                          defaultExpanded={rule.condition !== undefined && rule.condition.conditions.length > 0}
                        >
                          <p className={styles.note}>{strings.conditionHint}</p>
                          <FilterBuilder
                            attributes={conditionAttributes}
                            value={rule.condition ?? EMPTY_CONDITION}
                            onChange={(condition) => {
                              change(id, { condition });
                            }}
                            {...(editorProps === undefined ? {} : { editorProps })}
                          />
                          {errorOf('condition') !== undefined && (
                            <span className={styles.error} role="alert">
                              {errorOf('condition')}
                            </span>
                          )}
                        </Disclosure>
                      )}
                      <span className={styles.done}>
                        <Button
                          variant="secondary"
                          onPress={() => {
                            setOpenId(undefined);
                            focusIn(rowControl(id, 'button[aria-haspopup]'));
                          }}
                        >
                          {strings.done}
                        </Button>
                      </span>
                    </div>
                  )}
                </GridListItem>
              );
            }}
          </GridList>
        </SortableList>
      )}
      {!isReadOnly && kinds.length > 0 && (
        <span className={styles.adder} data-adder="">
          <MenuTrigger>
            <Button variant="ghost" icon="plus" isDisabled={isFull}>
              {strings.addRule}
            </Button>
            <Menu
              label={strings.ruleKinds}
              onAction={(key) => {
                const kind = kinds.find((each) => each === key);
                if (kind !== undefined && kind !== 'required_when') add(kind);
              }}
            >
              {kinds.flatMap((kind) =>
                kind === 'required_when'
                  ? []
                  : [
                      <MenuItem key={kind} id={kind} description={strings.kindHelp[kind]}>
                        {strings.kinds[kind]}
                      </MenuItem>,
                    ],
              )}
            </Menu>
          </MenuTrigger>
          {isFull && <span className={styles.note}>{strings.full(limit)}</span>}
        </span>
      )}
      <VisuallyHidden aria-live="polite">{said}</VisuallyHidden>
    </div>
  );
}

/** A condition with nothing in it yet: the rule applies to every record. */
const EMPTY_CONDITION: FilterGroup = { conjunction: 'and', conditions: [] };
