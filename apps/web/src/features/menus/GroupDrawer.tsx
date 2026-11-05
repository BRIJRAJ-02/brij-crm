// Brief
// Purpose: one option group in a drawer (after checklabs' modifier groups: required, minimum and maximum, enforced
// here where checklabs didn't): its name, how many a guest picks, and its options with their price changes.
// Main task: make a group such as Milk once, ready for every coffee.
// Leaves out: which dishes offer it (each dish's drawer).
import type { MenuDraft, MenuStore } from '@crm/data';
import { MENU_LIMITS, minorToDecimal, parsePrice } from '@crm/data/menu';
import { Button, Field, Form, SegmentedControl, Switch, type Toasts } from '@crm/ui';
import { useId, useState } from 'react';
import { DrawerForm } from './drawer.tsx';
import { strings } from './strings.ts';

interface OptionRow {
  readonly key: string;
  readonly id?: string;
  readonly name: string;
  readonly price: string;
}

/** Parses a price change ("1.50", "-0.50", "" as 0) in minor units, or undefined. */
function parseDelta(text: string, currency: string): number | undefined {
  const trimmed = text.trim().replace(/^\+/, '');
  if (trimmed === '') return 0;
  const negative = trimmed.startsWith('-') || trimmed.startsWith('−');
  const value = parsePrice(negative ? trimmed.slice(1) : trimmed, currency);
  return value === undefined ? undefined : negative ? -value : value;
}

/** A new option group, or one already made. */
export function GroupDrawer({
  store,
  slug,
  draft,
  groupId,
  toasts,
  onSaved,
  onClose,
}: {
  readonly store: MenuStore;
  readonly slug: string;
  readonly draft: MenuDraft;
  readonly groupId?: string;
  readonly toasts: Toasts;
  /** Told the group's id once it saved: an item's drawer that opened this one picks the new group. */
  readonly onSaved?: (groupId: string) => void;
  readonly onClose: () => void;
}) {
  const formId = useId();
  const { currency } = draft;
  const group = draft.groups.find((each) => each.id === groupId);
  const [id] = useState(() => group?.id ?? store.newId());
  const [name, setName] = useState(group?.name ?? '');
  const [rule, setRule] = useState<'one' | 'up_to' | 'any'>(group?.rule ?? 'one');
  const [max, setMax] = useState(group?.max === undefined ? '2' : String(group.max));
  const [isRequired, setRequired] = useState((group?.min ?? 0) > 0);
  const [options, setOptions] = useState<readonly OptionRow[]>(
    group?.options.map((option) => ({
      key: option.id,
      id: option.id,
      name: option.name,
      price: option.priceDeltaMinor === 0 ? '' : minorToDecimal(option.priceDeltaMinor, currency),
    })) ?? [
      { key: 'a', name: '', price: '' },
      { key: 'b', name: '', price: '' },
    ],
  );
  const [problems, setProblems] = useState<Readonly<Record<string, string>>>({});
  const [isSaving, setSaving] = useState(false);
  const [isDeleting, setDeleting] = useState(false);
  const usedBy = draft.items.filter((item) => item.groupIds.includes(id)).length;
  const baseline = JSON.stringify({
    name: group?.name ?? '',
    rule: group?.rule ?? 'one',
    isRequired: (group?.min ?? 0) > 0,
    options: (group?.options ?? []).map((option) => option.name),
  });
  const isDirty =
    JSON.stringify({
      name,
      rule,
      isRequired,
      options: options.map((option) => option.name).filter((n) => n !== ''),
    }) !== baseline;

  const save = async () => {
    const found: Record<string, string> = {};
    if (name.trim() === '') found.name = strings.groupNameMissing;
    const most = Number(max);
    if (rule === 'up_to' && (!Number.isInteger(most) || most < 1 || most > MENU_LIMITS.optionsPerGroup)) {
      found.max = strings.maxInvalid(MENU_LIMITS.optionsPerGroup);
    }
    const filled = options.filter((option) => option.name.trim() !== '' || option.price.trim() !== '');
    const parsed = filled.map((option) => ({ ...option, delta: parseDelta(option.price, currency) }));
    for (const option of parsed) {
      if (option.name.trim() === '' || option.delta === undefined)
        found[`option-${option.key}`] = strings.optionInvalid;
    }
    if (parsed.length === 0) found.options = strings.optionInvalid;
    setProblems(found);
    if (Object.keys(found).length > 0) return;
    setSaving(true);
    const refused = await store.saveGroup(slug, {
      id,
      name: name.trim(),
      rule,
      min: isRequired ? 1 : 0,
      ...(rule === 'up_to' ? { max: most } : {}),
      options: parsed.map((option) => ({
        ...(option.id === undefined ? {} : { id: option.id }),
        name: option.name.trim(),
        priceDeltaMinor: option.delta ?? 0,
      })),
    });
    setSaving(false);
    if (refused !== undefined) {
      toasts.toast({ tone: 'danger', message: refused.message });
      return;
    }
    onSaved?.(id);
    onClose();
  };

  return (
    <DrawerForm
      title={group?.name ?? strings.groupTitle}
      isDirty={isDirty}
      isBusy={isSaving}
      onClose={onClose}
      footerStart={
        group === undefined ? undefined : isDeleting ? (
          <Button
            variant="danger-solid"
            onPress={() => {
              void store.deleteGroup(slug, id).then((refused) => {
                if (refused !== undefined) toasts.toast({ tone: 'danger', message: refused.message });
                else onClose();
              });
            }}
          >
            {strings.deleteGroupQuestion(group.name)}
          </Button>
        ) : (
          <Button variant="ghost" icon="trash" onPress={() => setDeleting(true)}>
            {strings.deleteGroup}
          </Button>
        )
      }
      actions={
        <>
          <Button slot="close" isDisabled={isSaving}>
            {strings.cancel}
          </Button>
          <Button variant="primary" type="submit" form={formId} isPending={isSaving}>
            {strings.saveGroup}
          </Button>
        </>
      }
    >
      <Form id={formId} onSubmit={() => void save()}>
        <Field
          label={strings.groupName}
          value={name}
          onChange={setName}
          isRequired
          maxLength={MENU_LIMITS.groupNameMax}
          {...(problems.name === undefined ? {} : { error: problems.name })}
          {...(group === undefined
            ? {}
            : { hint: `${strings.usedBy(usedBy)}${isDeleting ? `. ${strings.deleteGroupLine}` : ''}` })}
        />
        <SegmentedControl
          label={strings.groupRule}
          isLabelVisible
          segments={[
            { value: 'one', label: strings.ruleOne },
            { value: 'up_to', label: strings.ruleUpTo },
            { value: 'any', label: strings.ruleAny },
          ]}
          value={rule}
          onChange={(next: string) => setRule(next === 'up_to' ? 'up_to' : next === 'any' ? 'any' : 'one')}
        />
        {rule === 'up_to' ? (
          <Field
            label={strings.groupMax}
            value={max}
            onChange={setMax}
            inputMode="numeric"
            {...(problems.max === undefined ? {} : { error: problems.max })}
          />
        ) : null}
        <Switch
          label={strings.required}
          description={strings.requiredHint}
          isSelected={isRequired}
          onChange={setRequired}
        />
        {options.map((option, index) => (
          <Field
            key={option.key}
            label={`${strings.optionName} ${String(index + 1)}`}
            // The price beside it is named on the row's own line, its currency in its box (UX review 15).
            labelAside={strings.andPriceChange}
            value={option.name}
            maxLength={MENU_LIMITS.optionNameMax}
            onChange={(value) =>
              setOptions((was) => was.map((each) => (each.key === option.key ? { ...each, name: value } : each)))
            }
            {...(problems[`option-${option.key}`] === undefined ? {} : { error: problems[`option-${option.key}`] })}
            after={
              <Field
                label={strings.optionPriceIn(draft.currency)}
                isLabelHidden
                prefix={draft.currency}
                placeholder="0.00"
                value={option.price}
                inputMode="decimal"
                onChange={(value) =>
                  setOptions((was) => was.map((each) => (each.key === option.key ? { ...each, price: value } : each)))
                }
              />
            }
            suffix={
              options.length > 1 ? (
                <Button
                  variant="ghost"
                  icon="x"
                  label={strings.removeOption(index + 1)}
                  onPress={() => setOptions((was) => was.filter((each) => each.key !== option.key))}
                />
              ) : undefined
            }
          />
        ))}
        {options.length >= MENU_LIMITS.optionsPerGroup ? null : (
          <Button
            icon="plus"
            onPress={() => setOptions((was) => [...was, { key: store.newId(), name: '', price: '' }])}
          >
            {strings.addOption}
          </Button>
        )}
      </Form>
    </DrawerForm>
  );
}
