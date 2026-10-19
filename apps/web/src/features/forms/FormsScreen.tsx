// Brief
// Purpose: Settings, Forms: the workspace's public forms, live, paused and draft, and the archived ones (spec 0023).
// Main task: owners and admins make a new form, or open one to build it or read its submissions.
// Leaves out: analytics, sites and embeds (later milestones), and anything about one form (its own page).
import { isDataError, type FormSummary, type FormView, type ObjectSummary } from '@crm/data';
import {
  Badge,
  Button,
  Callout,
  Disclosure,
  EmptyState,
  Field,
  Form,
  Icon,
  Modal,
  Select,
  Table,
  type TableColumn,
} from '@crm/ui';
import { useNavigate, useRouteContext } from '@tanstack/react-router';
import { useId, useState } from 'react';
import { formHref } from '../settings/nav.ts';
import { settingsCrumbs, SettingsPage } from '../settings/SettingsPage.tsx';
import { useCan } from '../workspace/WorkspacePage.tsx';
import { strings } from './strings.ts';

/** Props for Settings, Forms: what its route loaded through the data layer. */
export interface FormsScreenProps {
  readonly slug: string;
  readonly forms: readonly FormSummary[];
  readonly archived: readonly FormSummary[];
  /** The objects the person can see: a form's object, and the choice for a new one. */
  readonly objects: readonly ObjectSummary[];
}

const COLUMNS: readonly TableColumn[] = [
  { id: 'name', label: strings.nameColumn, isRowHeader: true },
  { id: 'status', label: strings.statusColumn },
  { id: 'object', label: strings.objectColumn, isInline: true },
  { id: 'submissions', label: strings.submissionsColumn, align: 'end' },
];

/** Settings, Forms: the active forms, then the archived ones in a disclosure. */
export function FormsScreen({ slug, forms, archived, objects }: FormsScreenProps) {
  const { data } = useRouteContext({ from: '__root__' });
  const navigate = useNavigate();
  const canManage = useCan('forms.manage');
  const [isCreating, setCreating] = useState(false);
  const byId = new Map(objects.map((object) => [object.id, object]));

  const cell = (form: FormSummary, column: string) => {
    switch (column) {
      case 'name':
        return form.name;
      case 'status':
        return <Badge text={strings.status[form.status]} tone={form.status === 'live' ? 'accent' : 'neutral'} />;
      case 'object': {
        const object = byId.get(form.mainObjectId);
        return object === undefined ? null : (
          <>
            <Icon name={object.icon} tile={object.hue} />
            {object.pluralName}
          </>
        );
      }
      default:
        return new Intl.NumberFormat().format(form.submissionCount);
    }
  };
  const open = (formId: string) => {
    void navigate({ href: formHref(slug, formId) });
  };
  return (
    <SettingsPage
      title={strings.forms}
      crumbs={settingsCrumbs(slug, 'objects')}
      description={strings.formsDescription}
      current="forms"
      {...(canManage
        ? {
            actions: (
              <Button variant="primary" icon="plus" onPress={() => setCreating(true)}>
                {strings.newForm}
              </Button>
            ),
          }
        : {})}
    >
      {!canManage && <Callout>{strings.readOnlyNote}</Callout>}
      <Table
        label={strings.forms}
        columns={COLUMNS}
        rows={forms}
        getRowId={(form) => form.id}
        renderCell={cell}
        onRowAction={open}
        emptyState={
          <EmptyState icon="clipboard-list" title={strings.noForms}>
            {canManage ? strings.noFormsText : strings.noFormsMemberText}
          </EmptyState>
        }
      />
      <Disclosure title={strings.archived} count={archived.length}>
        {archived.length === 0 ? (
          <EmptyState title={strings.noArchived} />
        ) : (
          <Table
            label={strings.archivedForms}
            columns={COLUMNS}
            rows={archived}
            getRowId={(form) => form.id}
            renderCell={cell}
            onRowAction={open}
          />
        )}
      </Disclosure>
      {canManage && (
        <NewFormDialog
          isOpen={isCreating}
          onOpenChange={setCreating}
          objects={objects.filter((object) => !object.isArchived)}
          newId={() => data.forms.newId()}
          onCreate={(input) => data.forms.create(slug, input)}
          onCreated={(form) => {
            setCreating(false);
            open(form.id);
          }}
        />
      )}
    </SettingsPage>
  );
}

/** Props for the new form dialog. */
interface NewFormDialogProps {
  readonly isOpen: boolean;
  readonly onOpenChange: (isOpen: boolean) => void;
  readonly objects: readonly ObjectSummary[];
  /** Mints the form's id, once per opening: a second press after a lost answer sends the same one. */
  readonly newId: () => string;
  readonly onCreate: (input: {
    readonly id: string;
    readonly name: string;
    readonly mainObjectId: string;
  }) => Promise<FormView>;
  readonly onCreated: (form: FormView) => void;
}

/** "New form": its name and the object it fills (People first); Create waits for the server. */
function NewFormDialog({ isOpen, onOpenChange, objects, newId, onCreate, onCreated }: NewFormDialogProps) {
  const formId = useId();
  const [isBusy, setBusy] = useState(false);
  const people = objects.find((object) => object.standardKey === 'people') ?? objects[0];
  const [id] = useState(newId);
  const [name, setName] = useState('');
  const [objectId, setObjectId] = useState<string | undefined>(people?.id);
  const [error, setError] = useState<string | undefined>(undefined);
  const create = () => {
    if (isBusy || objectId === undefined) return;
    if (name.trim() === '') {
      setError('Give the form a name.');
      return;
    }
    setBusy(true);
    setError(undefined);
    onCreate({ id, name: name.trim(), mainObjectId: objectId }).then(
      (form) => {
        setBusy(false);
        onCreated(form);
      },
      (failure: unknown) => {
        setBusy(false);
        setError(isDataError(failure) ? failure.message : strings.somethingWrong);
      },
    );
  };
  return (
    <Modal
      title={strings.newForm}
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open && isBusy) return;
        onOpenChange(open);
      }}
      actions={
        <>
          <Button slot="close" isDisabled={isBusy} kbd="ESC">
            {strings.cancel}
          </Button>
          <Button variant="primary" type="submit" form={formId} isPending={isBusy}>
            {isBusy ? strings.creatingForm : strings.createForm}
          </Button>
        </>
      }
    >
      <Form id={formId} isBusy={isBusy} onSubmit={create} focusesFirstField>
        <Field
          label={strings.formName}
          name="name"
          value={name}
          onChange={(value) => {
            setName(value);
            setError(undefined);
          }}
          hint={strings.formNameHint}
          {...(error === undefined ? {} : { error })}
          isRequired
        />
        <Select
          label={strings.object}
          hint={strings.objectHint}
          items={objects.map((object) => ({ id: object.id, label: object.pluralName, icon: object.icon }))}
          value={objectId ?? null}
          onChange={(value) => setObjectId(value ?? undefined)}
          isRequired
        />
      </Form>
    </Modal>
  );
}
