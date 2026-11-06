// Brief
// Purpose: Settings › Workspace › Connected apps (spec 0070, AC-7013): the outside apps connected to this workspace.
// Main task: an owner sees each app, what it may use, when it connected and its last call; changes its modules; and
// disconnects it after confirming, which stops it at once.
// Leaves out: connecting an app (it starts from the app's own button), the people an app added, and its call log.
import { isDataError, type ConnectedApp, type DataLayer, type PartnerModule } from '@crm/data';
import { useCaptureList } from '@crm/data/react';
import {
  Button,
  Checkbox,
  EmptyState,
  Form,
  Modal,
  PersonLine,
  RelativeTime,
  Table,
  type FormRefusal,
  type TableColumn,
  type Toasts,
} from '@crm/ui';
import { useId, useState } from 'react';
import { focusTitle } from '../navigation/focus-title.ts';
import { SettingsFailed, SettingsPage } from '../settings/SettingsPage.tsx';
import { toggled } from './connect-request.ts';
import { connectedStrings as strings, MODULES } from './strings.ts';

/** Props for Connected apps: the data layer and where it is. Only owners reach it. */
export interface ConnectedAppsScreenProps {
  readonly data: DataLayer;
  readonly toasts: Toasts;
  readonly slug: string;
  /** The page's name, as the settings navigation gives it. */
  readonly title: string;
}

const COLUMNS: readonly TableColumn[] = [
  { id: 'app', label: strings.columns.app, isRowHeader: true, size: 'fill' },
  { id: 'modules', label: strings.columns.modules, size: 'fit' },
  { id: 'connected', label: strings.columns.connected, size: 'fit' },
  { id: 'lastCall', label: strings.columns.lastCall, size: 'fit' },
  { id: 'actions', label: strings.columns.actions, isLabelHidden: true, align: 'end', size: 'fit', isInline: true },
];

const ALL_MODULES = Object.keys(MODULES) as PartnerModule[];

const messageOf = (error: unknown) => (isDataError(error) ? error.message : strings.failedTitle);

const moduleNames = (modules: readonly PartnerModule[]) => modules.map((module) => MODULES[module].label).join(', ');

/** Connected apps: a Table of the apps, Change and Disconnect on each row, and their dialogs. */
export function ConnectedAppsScreen({ data, toasts, slug, title }: ConnectedAppsScreenProps) {
  const list = useCaptureList(data.connectedApps.view(slug));
  const [changing, setChanging] = useState<ConnectedApp | undefined>(undefined);
  const [ending, setEnding] = useState<ConnectedApp | undefined>(undefined);

  const cell = (app: ConnectedApp, column: string) => {
    switch (column) {
      case 'app':
        return (
          <PersonLine
            id={app.id}
            name={app.partner.name}
            meta={app.approvedBy === undefined ? [] : [strings.by(app.approvedBy)]}
            size="md"
            {...(app.partner.logoUrl === undefined ? {} : { src: app.partner.logoUrl })}
          />
        );
      case 'modules':
        return moduleNames(app.modules);
      case 'connected':
        return <RelativeTime value={app.connectedAt} />;
      case 'lastCall':
        return app.lastCallAt === undefined ? strings.never : <RelativeTime value={app.lastCallAt} />;
      default:
        return (
          <>
            <Button size="sm" label={strings.change(app.partner.name)} onPress={() => setChanging(app)}>
              {strings.changeShort}
            </Button>
            <Button
              size="sm"
              variant="ghost-danger"
              label={strings.disconnect(app.partner.name)}
              onPress={() => setEnding(app)}
            >
              {strings.disconnectShort}
            </Button>
          </>
        );
    }
  };

  if (list.status === 'error') {
    return (
      <SettingsFailed
        title={title}
        heading={strings.failedTitle}
        text={list.error.message}
        onRetry={() => {
          data.connectedApps.view(slug).reload();
        }}
      />
    );
  }

  return (
    <SettingsPage title={title} isLoading={list.status === 'loading'}>
      {list.status === 'ready' && list.items.length === 0 ? (
        <EmptyState icon="plug" title={strings.emptyTitle}>
          {strings.emptyText}
        </EmptyState>
      ) : (
        <Table
          label={title}
          columns={COLUMNS}
          rows={list.status === 'ready' ? list.items : []}
          getRowId={(app) => app.id}
          renderCell={cell}
          isLoading={list.status === 'loading'}
          isScrollable
        />
      )}
      <ModulesDialog
        key={changing?.id ?? 'none'}
        app={changing}
        onClose={() => setChanging(undefined)}
        onSave={(app, modules) =>
          data.connectedApps.setModules(slug, app.id, modules).then(() => {
            toasts.toast({ tone: 'success', message: strings.saved(app.partner.name) });
          })
        }
      />
      <DisconnectDialog
        app={ending}
        onClose={() => setEnding(undefined)}
        onConfirm={(app) =>
          data.connectedApps.disconnect(slug, app.id).then(
            () => {
              // The row and its button went away.
              focusTitle();
              toasts.toast({ tone: 'success', message: strings.disconnected(app.partner.name) });
            },
            (error: unknown) => {
              toasts.toast({ tone: 'danger', message: messageOf(error) });
            },
          )
        }
      />
    </SettingsPage>
  );
}

/** What an app may use: a Checkbox per module, at least one, then Save. */
function ModulesDialog({
  app,
  onClose,
  onSave,
}: {
  readonly app: ConnectedApp | undefined;
  readonly onClose: () => void;
  readonly onSave: (app: ConnectedApp, modules: readonly PartnerModule[]) => Promise<void>;
}) {
  const formId = useId();
  const [modules, setModules] = useState<readonly PartnerModule[]>(app?.modules ?? []);
  const [isBusy, setBusy] = useState(false);
  const [refusals, setRefusals] = useState<readonly FormRefusal[]>([]);
  if (app === undefined) return null;
  const save = () => {
    if (isBusy) return;
    if (modules.length === 0) {
      setRefusals([{ code: 'INPUT_INVALID', message: strings.modulesMissing, attributeId: 'modules' }]);
      return;
    }
    setBusy(true);
    setRefusals([]);
    onSave(app, modules).then(
      () => {
        setBusy(false);
        onClose();
      },
      (error: unknown) => {
        setBusy(false);
        setRefusals([{ code: 'INPUT_INVALID', message: messageOf(error), attributeId: 'modules' }]);
      },
    );
  };
  const error = refusals[0]?.message;
  return (
    <Modal
      title={strings.modulesTitle(app.partner.name)}
      variant="form"
      isOpen
      onOpenChange={(open) => {
        if (!open && !isBusy) onClose();
      }}
      actions={
        <>
          <Button slot="close" isDisabled={isBusy}>
            {strings.cancel}
          </Button>
          <Button variant="primary" type="submit" form={formId} isPending={isBusy}>
            {isBusy ? strings.saving : strings.save}
          </Button>
        </>
      }
    >
      <Form
        id={formId}
        label={strings.modulesTitle(app.partner.name)}
        isBusy={isBusy}
        refusals={refusals}
        fieldFor={(refusal) => refusal.attributeId}
        onSubmit={save}
      >
        {strings.modulesText}
        {ALL_MODULES.map((module) => (
          <Checkbox
            key={module}
            label={MODULES[module].label}
            description={MODULES[module].power}
            isSelected={modules.includes(module)}
            onChange={(isOn) => setModules((now) => toggled(now, module, isOn))}
            {...(error === undefined ? {} : { error })}
          />
        ))}
      </Form>
    </Modal>
  );
}

/** Disconnect, asked first (an ending action): the app stops at once. */
function DisconnectDialog({
  app,
  onClose,
  onConfirm,
}: {
  readonly app: ConnectedApp | undefined;
  readonly onClose: () => void;
  readonly onConfirm: (app: ConnectedApp) => Promise<void>;
}) {
  // The last app stays while the Modal plays its exit.
  const [last, setLast] = useState(app);
  const [isBusy, setBusy] = useState(false);
  if (app !== undefined && app !== last) setLast(app);
  const shown = app ?? last;
  if (shown === undefined) return null;
  return (
    <Modal
      title={strings.confirmTitle(shown.partner.name)}
      variant="confirm"
      tone="danger"
      isOpen={app !== undefined}
      onOpenChange={(open) => {
        if (!open && !isBusy) onClose();
      }}
      actions={
        <>
          <Button slot="close" isDisabled={isBusy}>
            {strings.cancel}
          </Button>
          <Button
            variant="danger-solid"
            isPending={isBusy}
            onPress={() => {
              setBusy(true);
              void onConfirm(shown).finally(() => {
                setBusy(false);
                onClose();
              });
            }}
          >
            {isBusy ? strings.disconnecting : strings.confirm}
          </Button>
        </>
      }
    >
      {strings.confirmText(shown.partner.name)}
    </Modal>
  );
}

/** Connected apps while it loads: the head's place and rows where the list will be. */
export function ConnectedAppsPending({ title }: { readonly title: string }) {
  return (
    <SettingsPage title={title} isLoading>
      <Table label={title} columns={COLUMNS} rows={[]} getRowId={() => ''} renderCell={() => null} isLoading />
    </SettingsPage>
  );
}
