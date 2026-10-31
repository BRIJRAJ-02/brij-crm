// Brief
// Purpose: build or change one automation as a sentence: "When Deal Stage changes to Won, create a task Send contract for Owner due in 3 days".
// Main task: start from a chip (or the sentence as it is), change the blanks in place, then Turn on (new) or Save.
// Leaves out: branches, delays, email, an AI step, conditions through relations, and a name (the sentence is the name).
import {
  toFieldAttribute,
  type AttributeDefinition,
  type AutomationsHeld,
  type DataLayer,
  type FilterGroup,
  type MemberSummary,
  type ObjectSummary,
} from '@crm/data';
import {
  AttributeEditor,
  Button,
  ChoiceChips,
  Disclosure,
  Field,
  FilterBuilder,
  Modal,
  Select,
  Sentence,
  type FieldAttribute,
} from '@crm/ui';
import { useEffect, useMemo, useState } from 'react';
import {
  ANY,
  blankDraft,
  CREATED,
  starterDraft,
  STARTERS,
  TASK_SUBJECT,
  toDefinition,
  draftOf,
  type Draft,
  type DraftAction,
  type Names,
  type StarterId,
} from './model.ts';
import type { Automation } from '@crm/data';
import { strings } from './strings.ts';

/** Props for the automation dialog. */
export interface AutomationDialogProps {
  readonly data: DataLayer;
  readonly slug: string;
  readonly held: AutomationsHeld;
  readonly objects: readonly ObjectSummary[];
  readonly members: readonly MemberSummary[];
  /** The automation being changed; absent for a new one. */
  readonly automation?: Automation | undefined;
  /** A starter chip the dialog opens on (a new one). */
  readonly starter?: StarterId | undefined;
  readonly onClose: () => void;
}

/** Fields a "becomes" or a condition may name: a person's own, not references or the system's. */
const WATCHABLE = (each: AttributeDefinition) => !each.isArchived && !each.isSystem;
const SETTABLE_OUT = new Set(['record_reference', 'actor_reference', 'file', 'interaction', 'timestamp']);
const CONDITIONAL_OUT = new Set(['record_reference', 'actor_reference']);

const emptyFilter = (): FilterGroup => ({ conjunction: 'and', conditions: [] });

/** The dialog. It loads the subject object's fields as the sentence names it. */
export function AutomationDialog({
  data,
  slug,
  held,
  objects,
  members,
  automation,
  starter,
  onClose,
}: AutomationDialogProps) {
  const [loaded, setLoaded] = useState<ReadonlyMap<string, readonly AttributeDefinition[]>>(new Map());
  const [draft, setDraft] = useState<Draft | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [newId] = useState(() => held.newId());

  const ensure = (objectId: string): Promise<readonly AttributeDefinition[]> => {
    const have = loaded.get(objectId);
    if (have !== undefined) return Promise.resolve(have);
    return data.attributes.list(slug, objectId).then((list) => {
      setLoaded((now) => new Map(now).set(objectId, list));
      return list;
    });
  };
  const names: Names = useMemo(
    () => ({ objects, members, attributesOf: (objectId) => loaded.get(objectId) }),
    [objects, members, loaded],
  );

  // The first draft: the saved automation, a starter, or the blank sentence. Its object's fields load first, so the
  // sentence never shows a blank it has no words for.
  useEffect(() => {
    let isCurrent = true;
    const first = async () => {
      if (automation !== undefined) {
        const next = draftOf(automation);
        if (next.subject !== TASK_SUBJECT) await ensure(next.subject);
        if (isCurrent) setDraft(next);
        return;
      }
      const pipeline = objects.find((object) => !object.isArchived);
      const attributes = pipeline === undefined ? [] : await ensure(pipeline.id);
      const seen = { ...names, attributesOf: (id: string) => (id === pipeline?.id ? attributes : loaded.get(id)) };
      const next = (starter === undefined ? undefined : starterDraft(starter, seen)) ?? blankDraft(seen);
      if (isCurrent) setDraft(next);
    };
    void first();
    return () => {
      isCurrent = false;
    };
    // The first draft is made once, as the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const attributes = useMemo(
    () => (draft === undefined || draft.subject === TASK_SUBJECT ? [] : (loaded.get(draft.subject) ?? [])),
    [draft, loaded],
  );
  const fieldAttributes = useMemo<readonly FieldAttribute[]>(
    () =>
      attributes
        .filter((each) => WATCHABLE(each) && !CONDITIONAL_OUT.has(each.type))
        .map((each) => toFieldAttribute(each)),
    [attributes],
  );
  const definition = draft === undefined ? undefined : toDefinition(draft);
  const isNew = automation === undefined;

  if (draft === undefined) {
    return (
      <Modal
        title={isNew ? strings.dialog.newTitle : strings.dialog.editTitle}
        variant="window"
        isOpen
        onOpenChange={(open) => !open && onClose()}
      >
        {null}
      </Modal>
    );
  }

  const change = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
  const setAction = (index: number, action: DraftAction) =>
    change({ actions: draft.actions.map((each, at) => (at === index ? action : each)) });
  const chooseSubject = (subject: string) => {
    if (subject === draft.subject) return;
    const keep: DraftAction[] =
      subject === TASK_SUBJECT
        ? draft.actions.filter((a) => a.kind === 'notify')
        : draft.actions.filter((a) => a.kind !== 'set_field');
    change({
      subject,
      event: CREATED,
      to: ANY,
      conditions: undefined,
      actions: keep.length === 0 ? [{ kind: 'notify', who: 'owner', message: '' }] : keep,
    });
    if (subject !== TASK_SUBJECT) void ensure(subject);
  };
  const pickStarter = async (id: StarterId) => {
    const pipeline = objects.find((object) => !object.isArchived);
    const list = pipeline === undefined ? [] : await ensure(pipeline.id);
    const next = starterDraft(id, {
      ...names,
      attributesOf: (object) => (object === pipeline?.id ? list : loaded.get(object)),
    });
    if (next !== undefined) setDraft(next);
  };

  const subjectItems = [
    ...objects.filter((object) => !object.isArchived).map((object) => ({ id: object.id, label: object.singularName })),
    { id: TASK_SUBJECT, label: strings.dialog.taskSubject },
  ];
  const watched = attributes.filter(WATCHABLE);
  const eventItems = [
    { id: CREATED, label: strings.dialog.isCreated },
    ...watched.map((each) => ({ id: each.id, label: strings.dialog.changesTo(each.title) })),
  ];
  const changed = watched.find((each) => each.id === draft.event);
  const toItems =
    changed === undefined
      ? []
      : changed.type === 'checkbox'
        ? [
            { id: ANY, label: strings.dialog.toAny },
            { id: 'checked', label: strings.checked },
            { id: 'unchecked', label: strings.unchecked },
          ]
        : changed.type === 'select' || changed.type === 'status'
          ? [
              { id: ANY, label: strings.dialog.toAny },
              ...(changed.options ?? []).filter((o) => !o.isArchived).map((o) => ({ id: o.id, label: o.label })),
            ]
          : [];
  const whoItems = [
    { id: 'owner', label: strings.owner },
    ...members.map((member) => ({ id: member.id, label: member.name })),
  ];
  const settable = watched.filter((each) => !SETTABLE_OUT.has(each.type));
  const isTask = draft.subject === TASK_SUBJECT;
  const kindItems = [
    { id: 'create_task', label: strings.dialog.createTask },
    ...(isTask ? [] : [{ id: 'set_field', label: strings.dialog.setField }]),
    { id: 'notify', label: strings.dialog.notify },
  ];

  const save = async () => {
    if (definition === undefined) return;
    setBusy(true);
    const landed = isNew ? await held.create(newId, definition) : await held.update(automation.id, definition);
    setBusy(false);
    if (landed) onClose();
  };

  const actionLine = (action: DraftAction, index: number) => {
    const remove =
      draft.actions.length > 1 ? (
        <Button
          variant="ghost"
          icon="x"
          label={strings.dialog.removeAction(index + 1)}
          onPress={() => change({ actions: draft.actions.filter((_, at) => at !== index) })}
        />
      ) : undefined;
    const kind = (
      <Select
        label={`${strings.dialog.kind} ${String(index + 1)}`}
        isLabelHidden
        variant="inline"
        items={kindItems}
        value={action.kind}
        onChange={(next) => {
          if (next === 'create_task') setAction(index, { kind: 'create_task', title: '', who: 'owner', days: '1' });
          if (next === 'notify') setAction(index, { kind: 'notify', who: 'owner', message: '' });
          if (next === 'set_field')
            setAction(index, { kind: 'set_field', attributeId: settable[0]?.id ?? '', value: undefined });
        }}
      />
    );
    const lead = index === 0 ? strings.dialog.then : '';
    if (action.kind === 'create_task') {
      return (
        <Sentence key={index} lead={lead} end={remove}>
          {kind}
          <Field
            label={strings.dialog.taskTitle}
            isLabelHidden
            size="sm"
            placeholder={strings.dialog.titlePlaceholder}
            value={action.title}
            onChange={(title) => setAction(index, { ...action, title })}
          />
          {strings.dialog.forWord}
          <Select
            label={strings.dialog.who}
            isLabelHidden
            variant="inline"
            items={whoItems}
            value={action.who}
            onChange={(who) => who !== null && setAction(index, { ...action, who })}
          />
          {strings.dialog.dueIn}
          <Field
            label={strings.dialog.daysLabel}
            isLabelHidden
            size="sm"
            inputMode="numeric"
            value={action.days}
            onChange={(days) => setAction(index, { ...action, days })}
          />
          {strings.dialog.daysWord}
        </Sentence>
      );
    }
    if (action.kind === 'notify') {
      return (
        <Sentence key={index} lead={lead} end={remove}>
          {kind}
          <Select
            label={strings.dialog.who}
            isLabelHidden
            variant="inline"
            items={whoItems}
            value={action.who}
            onChange={(who) => who !== null && setAction(index, { ...action, who })}
          />
          <Field
            label={strings.dialog.messageLabel}
            isLabelHidden
            size="sm"
            placeholder={strings.dialog.messagePlaceholder}
            value={action.message}
            onChange={(message) => setAction(index, { ...action, message })}
          />
        </Sentence>
      );
    }
    const target = settable.find((each) => each.id === action.attributeId);
    return (
      <Sentence key={index} lead={lead} end={remove}>
        {kind}
        <Select
          label={strings.dialog.field}
          isLabelHidden
          variant="inline"
          items={settable.map((each) => ({ id: each.id, label: each.title }))}
          value={action.attributeId}
          onChange={(attributeId) =>
            attributeId !== null && setAction(index, { kind: 'set_field', attributeId, value: undefined })
          }
        />
        {strings.dialog.toValue}
        {target !== undefined && (
          <AttributeEditor
            attribute={toFieldAttribute(target)}
            value={action.value ?? null}
            surface="form"
            onCommit={(value) => setAction(index, { ...action, value })}
          />
        )}
      </Sentence>
    );
  };

  return (
    <Modal
      title={isNew ? strings.dialog.newTitle : strings.dialog.editTitle}
      variant="window"
      isOpen
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      actions={
        <>
          <Button slot="close" isDisabled={busy}>
            {strings.dialog.cancel}
          </Button>
          <Button variant="primary" isDisabled={definition === undefined} isPending={busy} onPress={() => void save()}>
            {isNew ? strings.dialog.turnOn : strings.dialog.save}
          </Button>
        </>
      }
    >
      {isNew && (
        <ChoiceChips
          label={strings.starters.label}
          isSingle
          choices={STARTERS.map((id) => ({ id, label: strings.starters[id] }))}
          selected={[]}
          onChange={(ids) => {
            const id = STARTERS.find((each) => each === ids[0]);
            if (id !== undefined) void pickStarter(id);
          }}
        />
      )}
      <Sentence lead={strings.dialog.when}>
        <Select
          label={strings.dialog.subject}
          isLabelHidden
          variant="inline"
          items={subjectItems}
          value={draft.subject}
          onChange={(subject) => subject !== null && chooseSubject(subject)}
        />
        {isTask ? (
          strings.dialog.isDue
        ) : (
          <>
            <Select
              label={strings.dialog.event}
              isLabelHidden
              variant="inline"
              items={eventItems}
              value={draft.event}
              onChange={(event) => event !== null && change({ event, to: ANY })}
            />
            {toItems.length > 0 && (
              <>
                {strings.dialog.toWord}
                <Select
                  label={strings.dialog.value}
                  isLabelHidden
                  variant="inline"
                  items={toItems.slice(1)}
                  placeholder={strings.dialog.toAny}
                  value={draft.to === ANY ? null : draft.to}
                  isClearable
                  onChange={(to) => change({ to: to ?? ANY })}
                />
              </>
            )}
          </>
        )}
      </Sentence>
      {!isTask && fieldAttributes.length > 0 && (
        <Disclosure title={strings.dialog.onlyIf} defaultExpanded={(draft.conditions?.conditions.length ?? 0) > 0}>
          <FilterBuilder
            attributes={fieldAttributes}
            value={draft.conditions ?? emptyFilter()}
            onChange={(conditions) => change({ conditions })}
          />
        </Disclosure>
      )}
      {draft.actions.map(actionLine)}
      {draft.actions.length < 3 && (
        <Button
          variant="ghost"
          icon="plus"
          onPress={() =>
            change({
              actions: [
                ...draft.actions,
                isTask
                  ? { kind: 'notify', who: 'owner', message: '' }
                  : { kind: 'create_task', title: '', who: 'owner', days: '1' },
              ],
            })
          }
        >
          {strings.dialog.addAction}
        </Button>
      )}
    </Modal>
  );
}
