// Brief
// Purpose: make a list (spec 0048, AC-4801): a working set of one object's records, such as a Sales pipeline.
// Main task: name it, pick its object (the page open, by default), Pipeline or Blank, then Create list; it opens.
// Leaves out: its icon and hue (the list tile and the next hue), "Each record once" (on), and fields (the list's "+").
//
// T11 (the owner, 5 November 2026: "not sure what this feature is, it's the same as objects"): one line under the
// title says what a list is, in the words of the object picked (a hand-picked set of people, with its own stages
// and columns, as Attio's lists are); it starts as a Pipeline, the kind a list is mostly for; and the name's example
// is named by what it tracks.
import { isDataError, type DataLayer, type ListTemplate, type ListView, type ObjectSummary } from '@crm/data';
import { Button, Field, Form, Modal, SegmentedControl, Select, type FormRefusal } from '@crm/ui';
import { useEffect, useId, useState } from 'react';
import { strings } from './strings.ts';

/** The most lists a workspace holds, archived ones included (spec 0048, AC-4805). */
const LIST_CAP = 500;

/** Props for the New list dialog. */
export interface NewListModalProps {
  readonly data: DataLayer;
  readonly slug: string;
  readonly isOpen: boolean;
  /** The live objects the member may write, in sidebar order: a list holds one of their records. */
  readonly objects: readonly ObjectSummary[];
  /** The object it starts on (the page open), else the first. */
  readonly objectId?: string | undefined;
  readonly onClose: () => void;
  /** The server made it: close, and open it. */
  readonly onMade: (list: ListView) => void;
}

/**
 * "New list" (Modal + Form): Of, Name and Start with, nothing else up front (simpler first, 30 October 2026).
 * Create waits for the server, so a name clash lands on Name.
 */
export function NewListModal({ isOpen, onClose, ...rest }: NewListModalProps) {
  const formId = useId();
  const [isBusy, setBusy] = useState(false);
  // The workspace holds 500 lists, archived ones included (AC-4805): the dialog says so and Create stays off.
  const isFull = useIsFull(rest.data, rest.slug, isOpen);
  // The object picked, held here so the line under the title names its records as it changes; each opening starts
  // again from the page's object.
  const [object, setObject] = useState<string | undefined>(undefined);
  if (!isOpen && object !== undefined) setObject(undefined);
  const shown =
    rest.objects.find((each) => each.id === object) ??
    rest.objects.find((each) => each.id === rest.objectId) ??
    rest.objects[0];
  return (
    <Modal
      title={strings.newList}
      {...(shown === undefined ? {} : { description: strings.newListLine(shown.pluralName) })}
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open && !isBusy) onClose();
      }}
      actions={
        <>
          <Button slot="close" isDisabled={isBusy}>
            {strings.cancel}
          </Button>
          <Button
            variant="primary"
            type="submit"
            form={formId}
            isPending={isBusy}
            isDisabled={rest.objects.length === 0 || isFull}
          >
            {isBusy ? strings.creatingList : strings.createList}
          </Button>
        </>
      }
    >
      {isOpen && (
        <NewListForm
          formId={formId}
          isBusy={isBusy}
          onBusyChange={setBusy}
          isFull={isFull}
          onObjectChange={setObject}
          {...rest}
        />
      )}
    </Modal>
  );
}

/** Whether the workspace's lists are at the cap, read through the data layer each time the dialog opens. */
function useIsFull(data: DataLayer, slug: string, isOpen: boolean): boolean {
  const [isFull, setFull] = useState(false);
  useEffect(() => {
    if (!isOpen) return undefined;
    let isCurrent = true;
    data.lists.all(slug).then(
      (all) => {
        if (isCurrent) setFull(all.length >= LIST_CAP);
      },
      () => undefined,
    );
    return () => {
      isCurrent = false;
    };
  }, [data, slug, isOpen]);
  return isFull;
}

/** The dialog's form, mounted afresh with each opening (its id minted once, sent again on a retry). */
function NewListForm({
  data,
  slug,
  objects,
  objectId,
  formId,
  isBusy,
  isFull,
  onBusyChange,
  onObjectChange,
  onMade,
}: Omit<NewListModalProps, 'isOpen' | 'onClose'> & {
  readonly formId: string;
  readonly isBusy: boolean;
  readonly isFull: boolean;
  readonly onBusyChange: (isBusy: boolean) => void;
  /** The object picked, for the line under the title. */
  readonly onObjectChange: (objectId: string) => void;
}) {
  const [id] = useState(() => data.lists.newId());
  const [object, setObject] = useState(() => objects.find((each) => each.id === objectId)?.id ?? objects[0]?.id ?? '');
  const [name, setName] = useState('');
  // A Pipeline first (T11): stages to move the records through are what a list is mostly for; Blank is a click away.
  const [template, setTemplate] = useState<ListTemplate>('pipeline');
  const [refusals, setRefusals] = useState<readonly FormRefusal[]>(
    objects.length === 0 ? [{ code: 'FORBIDDEN', message: strings.noWritableObjects }] : [],
  );

  const create = () => {
    if (isBusy || isFull || object === '') return;
    if (name.trim() === '') {
      setRefusals([{ code: 'INPUT_INVALID', message: strings.nameMissing, attributeId: 'name' }]);
      return;
    }
    onBusyChange(true);
    setRefusals([]);
    data.lists.create(slug, { id, objectId: object, name: name.trim(), template }).then(
      (made) => {
        onBusyChange(false);
        onMade(made);
      },
      (error: unknown) => {
        onBusyChange(false);
        if (!isDataError(error)) {
          setRefusals([{ code: 'INTERNAL', message: strings.createFailed }]);
          return;
        }
        const listed = (error.data?.refusals ?? []).map((refusal): FormRefusal => ({
          code: refusal.code,
          message: refusal.message,
          ...(refusal.field === 'name' ? { attributeId: 'name' } : {}),
        }));
        setRefusals(listed.length > 0 ? listed : [{ code: error.code, message: error.message }]);
      },
    );
  };

  return (
    <Form
      id={formId}
      isBusy={isBusy}
      refusals={isFull ? [{ code: 'LIMIT_REACHED', message: strings.listAtLimit }, ...refusals] : refusals}
      fieldFor={(refusal) => refusal.attributeId}
      onSubmit={create}
      label={strings.newList}
      focusesFirstField
    >
      <Field
        label={strings.name}
        name="name"
        autoComplete="off"
        isRequired
        maxLength={100}
        placeholder={strings.namePlaceholder}
        value={name}
        onChange={setName}
      />
      <Select
        label={strings.object}
        items={objects.map((each) => ({ id: each.id, label: each.pluralName, icon: each.icon, hue: each.hue }))}
        value={object === '' ? null : object}
        onChange={(next) => {
          if (next === null) return;
          setObject(next);
          onObjectChange(next);
        }}
      />
      <SegmentedControl
        label={strings.startWith}
        // Named on screen as Name and List of are, so the three read down one rhythm.
        isLabelVisible
        segments={[
          { value: 'pipeline', label: strings.pipeline, icon: 'kanban' },
          { value: 'blank', label: strings.blank, icon: 'table' },
        ]}
        value={template}
        onChange={(next) => {
          if (next === 'blank' || next === 'pipeline') setTemplate(next);
        }}
      />
    </Form>
  );
}
