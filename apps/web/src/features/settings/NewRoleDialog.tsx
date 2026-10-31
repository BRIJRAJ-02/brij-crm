// Brief
// Purpose: make a custom role from Settings › Roles (spec 0037, AC-1228, AC-1229).
// Main task: name it, pick what it starts from (Member, Viewer or a custom role), Create; its page opens next.
// Leaves out: the permissions themselves (its page, right after), and copying a role (the row's Duplicate).
import type { DataAccess, Permission, RoleDefinition, StartFrom } from '@crm/data';
import { Button, Field, Form, Modal, Select, type FormRefusal } from '@crm/ui';
import { useId, useState } from 'react';
import { formRefusals } from './refusals.ts';
import { startOf } from './roles.ts';
import { strings } from './roles-strings.ts';

/** What a new role is made with. */
export interface NewRole {
  readonly name: string;
  readonly description?: string;
  readonly permissions: readonly Permission[];
  readonly dataAccess: DataAccess;
  readonly startFrom: StartFrom;
}

/** Props for the New role dialog. */
export interface NewRoleDialogProps {
  readonly isOpen: boolean;
  readonly onOpenChange: (isOpen: boolean) => void;
  /** Every role (`roles.overview`): Start from offers Member, Viewer and the custom ones. */
  readonly roles: readonly RoleDefinition[];
  /** Makes it and waits for the server; rejects with its refusals, which land on the name or above the fields. */
  readonly onCreate: (role: NewRole) => Promise<void>;
}

const FIELDS = ['name', 'description'] as const;

/** "New role": a Modal with Name, Description and Start from; Create waits for the server. */
export function NewRoleDialog({ isOpen, onOpenChange, roles, onCreate }: NewRoleDialogProps) {
  const formId = useId();
  const [isBusy, setBusy] = useState(false);
  return (
    <Modal
      title={strings.createTitle}
      variant="form"
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open && isBusy) return;
        onOpenChange(open);
      }}
      actions={
        <>
          <Button slot="close" isDisabled={isBusy}>
            {strings.cancel}
          </Button>
          <Button variant="primary" type="submit" form={formId} isPending={isBusy}>
            {isBusy ? strings.creating : strings.create}
          </Button>
        </>
      }
    >
      {isOpen && (
        <NewRoleForm
          formId={formId}
          roles={roles}
          isBusy={isBusy}
          onBusyChange={setBusy}
          onCreate={onCreate}
          onCreated={() => {
            onOpenChange(false);
          }}
        />
      )}
    </Modal>
  );
}

/** The form, mounted afresh with each opening. */
function NewRoleForm({
  formId,
  roles,
  isBusy,
  onBusyChange,
  onCreate,
  onCreated,
}: Pick<NewRoleDialogProps, 'roles' | 'onCreate'> & {
  readonly formId: string;
  readonly isBusy: boolean;
  readonly onBusyChange: (isBusy: boolean) => void;
  readonly onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [from, setFrom] = useState<string>('member');
  const [refusals, setRefusals] = useState<readonly FormRefusal[]>([]);
  const starts = [
    { id: 'member', label: strings.member, description: strings.memberHint },
    { id: 'viewer', label: strings.viewer, description: strings.viewerHint },
    ...roles
      .filter((role) => role.builtIn === undefined)
      .map((role) => ({ id: role.id, label: role.label, group: strings.custom })),
  ];
  const create = () => {
    if (isBusy) return;
    if (name.trim() === '') {
      setRefusals([{ code: 'INPUT_INVALID', message: strings.nameMissing, attributeId: 'name' }]);
      return;
    }
    onBusyChange(true);
    setRefusals([]);
    const start = startOf(roles, from);
    onCreate({
      name: name.trim(),
      ...(description.trim() === '' ? {} : { description: description.trim() }),
      permissions: start.permissions,
      dataAccess: start.dataAccess,
      startFrom: from,
    }).then(
      () => {
        onBusyChange(false);
        onCreated();
      },
      (error: unknown) => {
        onBusyChange(false);
        setRefusals(formRefusals(error, FIELDS));
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
      label={strings.createTitle}
      focusesFirstField
    >
      <Field
        label={strings.name}
        placeholder={strings.namePlaceholder}
        name="name"
        autoComplete="off"
        isRequired
        maxLength={40}
        value={name}
        onChange={setName}
      />
      <Field
        label={strings.description}
        placeholder={strings.descriptionPlaceholder}
        name="description"
        autoComplete="off"
        maxLength={200}
        value={description}
        onChange={setDescription}
      />
      <Select
        label={strings.startFrom}
        items={starts}
        optionDescription="below"
        value={from}
        onChange={(chosen) => {
          if (chosen !== null) setFrom(chosen);
        }}
      />
    </Form>
  );
}
