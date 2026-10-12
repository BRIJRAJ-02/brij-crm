// Brief
// Purpose: create a custom object (Projects, Partners) from Settings, Objects.
// Main task: name it (one and many), keep or change the API name, pick its icon and colour, then Create object.
// Leaves out: attributes (the object starts with Name and the system ones; the Attributes tab adds the rest).
import { freeHue, toApiSlug, type Hue, type NewObject, type ObjectIcon, type ObjectSummary } from '@crm/data';
import { Button, Field, Form, Modal, type FormRefusal } from '@crm/ui';
import { useId, useState } from 'react';
import { ObjectHueField, ObjectIconButton } from './ObjectLookFields.tsx';
import { formRefusals, objectWords } from './refusals.ts';
import { strings } from './strings.ts';

/** The form's field names, as the server names them on its refusals. */
const FIELDS = ['singularName', 'pluralName', 'apiSlug', 'icon', 'hue'] as const;

/** Props for the new object dialog. */
export interface NewObjectDialogProps {
  readonly isOpen: boolean;
  readonly onOpenChange: (isOpen: boolean) => void;
  /** The workspace's live objects: the first colour none of them uses is the new one's. */
  readonly objects: readonly ObjectSummary[];
  /** Mints the new object's id, once per opening: a second press after a lost answer sends the same one. */
  readonly newId: () => string;
  /** Creates it and waits for the server; rejects with the refusals. */
  readonly onCreate: (input: NewObject) => Promise<ObjectSummary>;
  /** The server made it: close, and open its settings. */
  readonly onCreated: (object: ObjectSummary) => void;
}

/** "New object": a Modal with the names, the API name, the icon and the colour; Create waits for the server. */
export function NewObjectDialog({ isOpen, onOpenChange, objects, newId, onCreate, onCreated }: NewObjectDialogProps) {
  const formId = useId();
  const [isBusy, setBusy] = useState(false);
  return (
    <Modal
      title={strings.newObject}
      isOpen={isOpen}
      // While the server answers, the dialog stays: a refusal has to land on its field.
      onOpenChange={(open) => {
        if (!open && isBusy) return;
        onOpenChange(open);
      }}
      actions={
        <>
          <Button slot="close" isDisabled={isBusy} kbd="ESC">
            {strings.cancel}
          </Button>
          <Button variant="primary" type="submit" form={formId} isPending={isBusy} kbd="⌘↵">
            {isBusy ? strings.creatingObject : strings.createObject}
          </Button>
        </>
      }
    >
      <NewObjectForm
        formId={formId}
        objects={objects}
        newId={newId}
        isBusy={isBusy}
        onBusyChange={setBusy}
        onCreate={onCreate}
        onCreated={onCreated}
      />
    </Modal>
  );
}

/** Props for the dialog's form, mounted afresh with each opening. */
interface NewObjectFormProps extends Pick<NewObjectDialogProps, 'objects' | 'newId' | 'onCreate' | 'onCreated'> {
  readonly formId: string;
  readonly isBusy: boolean;
  readonly onBusyChange: (isBusy: boolean) => void;
}

/**
 * The form: the plural follows the singular plus "s", and the API name
 * follows the plural (the server's own `toApiSlug`), each until the person
 * edits it.
 */
function NewObjectForm({ formId, objects, newId, isBusy, onBusyChange, onCreate, onCreated }: NewObjectFormProps) {
  // One id per opening, sent again on every press.
  const [id] = useState(newId);
  const [singular, setSingular] = useState('');
  const [plural, setPlural] = useState<string | undefined>(undefined);
  const [apiSlug, setApiSlug] = useState<string | undefined>(undefined);
  const [icon, setIcon] = useState<ObjectIcon>('box');
  const [hue, setHue] = useState<Hue>(() => freeHue(objects.filter((object) => !object.isArchived)));
  const [refusals, setRefusals] = useState<readonly FormRefusal[]>([]);
  const pluralShown = plural ?? (singular.trim() === '' ? '' : `${singular.trim()}s`);
  const slugShown = apiSlug ?? (pluralShown.trim() === '' ? '' : toApiSlug(pluralShown, 'object'));

  const create = () => {
    if (isBusy) return;
    const missing = [
      ...(singular.trim() === '' ? ['singularName'] : []),
      ...(pluralShown.trim() === '' ? ['pluralName'] : []),
    ].map((field) => ({ code: 'INPUT_INVALID', message: strings.nameMissing, attributeId: field }));
    if (missing.length > 0) {
      setRefusals(missing);
      return;
    }
    onBusyChange(true);
    setRefusals([]);
    onCreate({
      id,
      singularName: singular.trim(),
      pluralName: pluralShown.trim(),
      // Sent only when the person typed one; the server derives the same otherwise.
      ...(apiSlug === undefined || apiSlug.trim() === '' ? {} : { apiSlug: apiSlug.trim() }),
      icon,
      hue,
    }).then(
      (object) => {
        onBusyChange(false);
        onCreated(object);
      },
      (error: unknown) => {
        onBusyChange(false);
        setRefusals(formRefusals(error, FIELDS, objectWords));
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
      label={strings.newObject}
      focusesFirstField
    >
      <Field
        label={strings.singularName}
        prefix={<ObjectIconButton icon={icon} hue={hue} onChange={setIcon} />}
        name="singularName"
        autoComplete="off"
        isRequired
        maxLength={100}
        value={singular}
        onChange={setSingular}
      />
      <Field
        label={strings.pluralName}
        name="pluralName"
        autoComplete="off"
        isRequired
        maxLength={100}
        value={pluralShown}
        onChange={setPlural}
      />
      <Field
        label={strings.apiName}
        name="apiSlug"
        autoComplete="off"
        maxLength={63}
        hint={strings.apiNameHint}
        value={slugShown}
        // Emptied, it follows the plural again.
        onChange={(next) => {
          setApiSlug(next === '' ? undefined : next);
        }}
      />
      <ObjectHueField hue={hue} onChange={setHue} />
    </Form>
  );
}
