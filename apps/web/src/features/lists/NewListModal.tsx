// Brief
// Purpose: make a list (spec 0048, AC-4801): a working set of one object's records, such as a Sales pipeline.
// Main task: name it, pick its object (the page open, by default), Blank or Pipeline, then Create list; it opens.
// Leaves out: its icon and hue (the list tile and the next hue), "Each record once" (on), and fields (the list's "+").
import { isDataError, type DataLayer, type ListTemplate, type ListView, type ObjectSummary } from '@crm/data';
import { Button, Field, Form, Modal, SegmentedControl, Select, type FormRefusal } from '@crm/ui';
import { useId, useState } from 'react';
import { strings } from './strings.ts';

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
  return (
    <Modal
      title={strings.newList}
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
            isDisabled={rest.objects.length === 0}
          >
            {isBusy ? strings.creatingList : strings.createList}
          </Button>
        </>
      }
    >
      {isOpen && <NewListForm formId={formId} isBusy={isBusy} onBusyChange={setBusy} {...rest} />}
    </Modal>
  );
}

/** The dialog's form, mounted afresh with each opening (its id minted once, sent again on a retry). */
function NewListForm({
  data,
  slug,
  objects,
  objectId,
  formId,
  isBusy,
  onBusyChange,
  onMade,
}: Omit<NewListModalProps, 'isOpen' | 'onClose'> & {
  readonly formId: string;
  readonly isBusy: boolean;
  readonly onBusyChange: (isBusy: boolean) => void;
}) {
  const [id] = useState(() => data.lists.newId());
  const [object, setObject] = useState(() => objects.find((each) => each.id === objectId)?.id ?? objects[0]?.id ?? '');
  const [name, setName] = useState('');
  const [template, setTemplate] = useState<ListTemplate>('blank');
  const [refusals, setRefusals] = useState<readonly FormRefusal[]>(
    objects.length === 0 ? [{ code: 'FORBIDDEN', message: strings.noWritableObjects }] : [],
  );

  const create = () => {
    if (isBusy || object === '') return;
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
      refusals={refusals}
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
          if (next !== null) setObject(next);
        }}
      />
      <SegmentedControl
        label={strings.startWith}
        segments={[
          { value: 'blank', label: strings.blank, icon: 'table' },
          { value: 'pipeline', label: strings.pipeline, icon: 'kanban' },
        ]}
        value={template}
        onChange={(next) => {
          if (next === 'blank' || next === 'pipeline') setTemplate(next);
        }}
      />
    </Form>
  );
}
