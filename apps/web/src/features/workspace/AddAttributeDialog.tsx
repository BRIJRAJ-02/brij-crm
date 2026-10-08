// Brief
// Purpose: add a column (an attribute) to the object, from the view bar.
// Main task: name it, pick one of the eight types, then Add attribute; the column appears once the server agrees.
// Leaves out: select, status, currency and relation types, defaults, uniqueness and descriptions (#13).
import { isDataError, type AttributeDefinition, type CreatableAttributeType } from '@crm/data';
import { Button, Field, fieldTypeOf, Form, Modal, Select, typeLabelOf, type FormRefusal } from '@crm/ui';
import { useId, useState } from 'react';
import { strings } from './strings.ts';

/** The types Add attribute offers in this loop, in the order AC-37 lists them. */
const TYPES: readonly CreatableAttributeType[] = [
  'text',
  'long_text',
  'number',
  'date',
  'checkbox',
  'email',
  'url',
  'rating',
];

const TYPE_ITEMS = TYPES.map((type) => ({ id: type, label: typeLabelOf(type), icon: fieldTypeOf(type).icon }));

const isCreatable = (id: string | null): id is CreatableAttributeType =>
  id !== null && (TYPES as readonly string[]).includes(id);

/** The form's field names. */
const FIELDS = { title: 'title' } as const;

/** Props for the add attribute dialog. */
export interface AddAttributeDialogProps {
  readonly isOpen: boolean;
  readonly onOpenChange: (isOpen: boolean) => void;
  /** Adds it and waits for the server; rejects with the refusals. */
  readonly onAdd: (input: {
    readonly title: string;
    readonly type: CreatableAttributeType;
  }) => Promise<AttributeDefinition>;
  /** The server added it: close, and show the column. */
  readonly onAdded: (attribute: AttributeDefinition) => void;
}

/** The server's refusals as this form's, a taken name on the name field in the dialog's own words. */
function refusalsOf(error: unknown): readonly FormRefusal[] {
  if (!isDataError(error)) return [{ code: 'INTERNAL', message: String(error) }];
  const refusals = (error.data?.refusals ?? []).map((refusal) => ({
    code: refusal.code,
    message: refusal.code === 'SLUG_TAKEN' ? strings.attributeNameTaken : refusal.message,
    ...(refusal.field === undefined ? {} : { attributeId: refusal.field }),
  }));
  const issues = (error.data?.issues ?? []).map((issue) => {
    const [field] = issue.path;
    return {
      code: error.code,
      message: issue.message,
      ...(field === FIELDS.title ? { attributeId: FIELDS.title } : {}),
    };
  });
  const all = [...refusals, ...issues];
  if (all.length > 0) return all;
  if (error.code === 'SLUG_TAKEN')
    return [{ code: error.code, message: strings.attributeNameTaken, attributeId: FIELDS.title }];
  return [{ code: error.code, message: error.message }];
}

/** "Add attribute": a Modal with the name and the type; Add waits for the server and shows a refusal in place. */
export function AddAttributeDialog({ isOpen, onOpenChange, onAdd, onAdded }: AddAttributeDialogProps) {
  const formId = useId();
  const [title, setTitle] = useState('');
  const [type, setType] = useState<CreatableAttributeType>('text');
  const [isBusy, setBusy] = useState(false);
  const [refusals, setRefusals] = useState<readonly FormRefusal[]>([]);
  // Each opening starts empty.
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      setTitle('');
      setType('text');
      setRefusals([]);
      setBusy(false);
    }
  }

  const add = () => {
    if (isBusy) return;
    const name = title.trim();
    if (name === '') {
      setRefusals([{ code: 'INPUT_INVALID', message: strings.attributeNameMissing, attributeId: FIELDS.title }]);
      return;
    }
    setBusy(true);
    setRefusals([]);
    onAdd({ title: name, type }).then(
      (attribute) => {
        setBusy(false);
        onAdded(attribute);
      },
      (error: unknown) => {
        setBusy(false);
        setRefusals(refusalsOf(error));
      },
    );
  };

  return (
    <Modal
      title={strings.addAttribute}
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      actions={
        <>
          <Button slot="close">{strings.cancel}</Button>
          <Button variant="primary" type="submit" form={formId} isPending={isBusy}>
            {isBusy ? strings.adding : strings.addAttribute}
          </Button>
        </>
      }
    >
      <Form
        id={formId}
        isBusy={isBusy}
        refusals={refusals}
        fieldFor={(refusal) => refusal.attributeId}
        onSubmit={add}
        label={strings.addAttribute}
      >
        <Field
          label={strings.attributeName}
          name={FIELDS.title}
          autoComplete="off"
          isRequired
          maxLength={100}
          value={title}
          onChange={setTitle}
        />
        <Select
          label={strings.attributeType}
          items={TYPE_ITEMS}
          value={type}
          onChange={(id) => {
            if (isCreatable(id)) setType(id);
          }}
        />
      </Form>
    </Modal>
  );
}
