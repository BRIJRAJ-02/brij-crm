// Brief
// Purpose: Settings › Workspace › Developer (parity #34): the workspace's API keys for the public API at /api/v1.
// Main task: an owner or admin makes a key (a name, Read or Read and write), copies it once, and revokes it later
// with Undo; the list says when each was last used.
// Leaves out: webhooks (spec 0064's page), keys for some objects only, rolling a key, and usage charts.
import { isDataError, type ApiKey, type ApiKeyAccess, type DataLayer } from '@crm/data';
import { useCaptureList } from '@crm/data/react';
import {
  Button,
  Code,
  EmptyState,
  Field,
  Form,
  Link,
  Modal,
  Radio,
  RadioGroup,
  RelativeTime,
  Table,
  type FormRefusal,
  type TableColumn,
  type Toasts,
} from '@crm/ui';
import { useId, useState } from 'react';
import { focusTitle } from '../navigation/focus-title.ts';
import { strings } from './developer-strings.ts';
import { formRefusals } from './refusals.ts';
import { SettingsFailed, SettingsPage } from './SettingsPage.tsx';

/** The public API's reference, from the very schemas it parses with. */
const REFERENCE = '/api/v1/openapi.json';

/** Props for the Developer page: the data layer and where it is. Only holders of `api_keys.manage` reach it. */
export interface DeveloperScreenProps {
  readonly data: DataLayer;
  readonly toasts: Toasts;
  readonly slug: string;
}

const COLUMNS: readonly TableColumn[] = [
  { id: 'name', label: strings.columns.name, isRowHeader: true },
  { id: 'access', label: strings.columns.access },
  { id: 'key', label: strings.columns.key },
  { id: 'lastUsed', label: strings.columns.lastUsed },
  { id: 'actions', label: strings.columns.actions, isLabelHidden: true, align: 'end' },
];

/** The message a refusal shows, in the server's words when it gave any. */
const messageOf = (error: unknown) => (isDataError(error) ? error.message : strings.somethingWrong);

/** The Developer page: the keys as a table, Create key in the page head, and the dialog that shows a new key once. */
export function DeveloperScreen({ data, toasts, slug }: DeveloperScreenProps) {
  const list = useCaptureList(data.apiKeys.view(slug));
  const [isCreating, setCreating] = useState(false);
  // Each opening mounts a fresh dialog (an empty form, a new id); closing keeps it, so its exit shows what it showed.
  const [opening, setOpening] = useState(0);

  // A revoke is one click with Undo: the key stops working at once, and Undo within its window brings it back.
  const revoke = (key: ApiKey) => {
    data.apiKeys.revoke(slug, key.id).then(
      () => {
        // The button that asked went away with the row.
        focusTitle();
        toasts.toast({
          tone: 'success',
          message: strings.revoked(key.name),
          action: {
            label: strings.undo,
            onAction: () => {
              data.apiKeys.restore(slug, key.id).then(
                () => {
                  toasts.toast({ tone: 'success', message: strings.restored(key.name) });
                },
                (error: unknown) => {
                  toasts.toast({ tone: 'danger', message: messageOf(error) });
                },
              );
            },
          },
        });
      },
      (error: unknown) => {
        toasts.toast({ tone: 'danger', message: messageOf(error) });
      },
    );
  };

  const cell = (key: ApiKey, column: string) => {
    switch (column) {
      case 'name':
        return key.name;
      case 'access':
        return strings.access[key.access];
      case 'key':
        return <Code>{strings.hint(key.hint)}</Code>;
      case 'lastUsed':
        return key.lastUsedAt === undefined ? strings.never : <RelativeTime value={key.lastUsedAt} />;
      default:
        return (
          <Button
            variant="ghost-danger"
            icon="trash"
            label={strings.revoke(key.name)}
            onPress={() => {
              revoke(key);
            }}
          />
        );
    }
  };

  const create = (
    <Button
      variant="primary"
      icon="plus"
      onPress={() => {
        setOpening((count) => count + 1);
        setCreating(true);
      }}
    >
      {strings.createKey}
    </Button>
  );

  if (list.status === 'error') {
    return (
      <SettingsFailed
        title={strings.title}
        heading={strings.failedTitle}
        text={list.error.message}
        onRetry={() => {
          data.apiKeys.view(slug).reload();
        }}
      />
    );
  }

  return (
    <SettingsPage
      title={strings.title}
      actions={create}
      meta={
        <Link href={REFERENCE} opensInNewTab>
          {strings.reference}
        </Link>
      }
      isLoading={list.status === 'loading'}
    >
      {list.status === 'ready' && list.items.length === 0 ? (
        <EmptyState icon="code" title={strings.emptyTitle}>
          {strings.emptyText}
        </EmptyState>
      ) : (
        <Table
          label={strings.title}
          columns={COLUMNS}
          rows={list.status === 'ready' ? list.items : []}
          getRowId={(key) => key.id}
          renderCell={cell}
          isLoading={list.status === 'loading'}
          isScrollable
        />
      )}
      <CreateKeyDialog key={opening} data={data} slug={slug} isOpen={isCreating} onOpenChange={setCreating} />
    </SettingsPage>
  );
}

/** Create key: a name and what it may do, then the whole key, shown this once with Copy. */
function CreateKeyDialog({
  data,
  slug,
  isOpen,
  onOpenChange,
}: Pick<DeveloperScreenProps, 'data' | 'slug'> & {
  readonly isOpen: boolean;
  readonly onOpenChange: (isOpen: boolean) => void;
}) {
  const formId = useId();
  // One id per opening: a retry after a lost answer sends the same one, and the server refuses a second key.
  const [id] = useState(() => data.apiKeys.newId());
  const [name, setName] = useState('');
  const [access, setAccess] = useState<ApiKeyAccess>('read');
  const [isBusy, setBusy] = useState(false);
  const [refusals, setRefusals] = useState<readonly FormRefusal[]>([]);
  const [token, setToken] = useState<string | undefined>(undefined);

  const submit = () => {
    if (isBusy) return;
    if (name.trim() === '') {
      setRefusals([{ code: 'INPUT_INVALID', message: strings.dialog.nameMissing, attributeId: 'name' }]);
      return;
    }
    setBusy(true);
    setRefusals([]);
    data.apiKeys.create(slug, { id, name: name.trim(), access }).then(
      (made) => {
        setBusy(false);
        setToken(made.token);
      },
      (error: unknown) => {
        setBusy(false);
        setRefusals(formRefusals(error, ['name']));
      },
    );
  };

  if (token !== undefined) {
    return (
      <Modal
        title={strings.dialog.shownTitle}
        variant="form"
        isOpen={isOpen}
        onOpenChange={onOpenChange}
        actions={
          <Button variant="primary" slot="close">
            {strings.dialog.done}
          </Button>
        }
      >
        <Code variant="block" isCopyable copyLabel={strings.dialog.copy}>
          {token}
        </Code>
        {strings.dialog.shownText}
      </Modal>
    );
  }

  return (
    <Modal
      title={strings.dialog.title}
      variant="form"
      isOpen={isOpen}
      // While the server answers, the dialog stays: a refusal has to land on its field.
      onOpenChange={(open) => {
        if (!open && isBusy) return;
        onOpenChange(open);
      }}
      actions={
        <>
          <Button slot="close" isDisabled={isBusy}>
            {strings.dialog.cancel}
          </Button>
          <Button variant="primary" type="submit" form={formId} isPending={isBusy}>
            {isBusy ? strings.dialog.creating : strings.dialog.create}
          </Button>
        </>
      }
    >
      <Form
        id={formId}
        isBusy={isBusy}
        refusals={refusals}
        fieldFor={(refusal) => refusal.attributeId}
        onSubmit={submit}
        label={strings.dialog.title}
        focusesFirstField
      >
        <Field
          label={strings.dialog.name}
          placeholder={strings.dialog.namePlaceholder}
          name="name"
          autoComplete="off"
          isRequired
          maxLength={80}
          value={name}
          onChange={setName}
        />
        <RadioGroup
          label={strings.dialog.access}
          value={access}
          onChange={(value) => {
            if (value === 'read' || value === 'write') setAccess(value);
          }}
        >
          <Radio value="read" description={strings.dialog.readDescription}>
            {strings.access.read}
          </Radio>
          <Radio value="write" description={strings.dialog.writeDescription}>
            {strings.access.write}
          </Radio>
        </RadioGroup>
      </Form>
    </Modal>
  );
}

/** The Developer page while it loads: the head's place and rows where the list will be. */
export function DeveloperPending() {
  return (
    <SettingsPage title={strings.loading} isLoading>
      <Table
        label={strings.loading}
        columns={COLUMNS}
        rows={[]}
        getRowId={() => ''}
        renderCell={() => null}
        isLoading
      />
    </SettingsPage>
  );
}
