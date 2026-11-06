// Brief
// Purpose: Settings › Super admin › Partners (spec 0070, AC-7010): the outside products allowed to connect
// workspaces to Timefix.
// Main task: a super admin registers a partner (name, logo, the sites that may embed Timefix, the addresses that
// receive a connection), copies its client id and its secret, shown once, and later edits it or replaces the secret.
// Leaves out: the workspaces each partner connected (slice 3's console), billing, and deleting a partner.
import {
  isDataError,
  type DataLayer,
  type PartnerLogoUpload,
  type PartnerView,
  type PartnerWithSecret,
} from '@crm/data';
import {
  Avatar,
  Button,
  Callout,
  Code,
  DescriptionList,
  EmptyState,
  Field,
  FileDrop,
  Form,
  Modal,
  RelativeTime,
  Table,
  type FormRefusal,
  type TableColumn,
  type Toasts,
} from '@crm/ui';
import { useEffect, useId, useState } from 'react';
import { SettingsPage } from '../settings/SettingsPage.tsx';
import { formRefusals } from '../settings/refusals.ts';
import { AdminFailed, useAdminRetry } from '../admin/AdminParts.tsx';
import { partnersStrings as strings } from './strings.ts';

/** Props for the Partners page. Only super admins reach it; the server checks every call on its own. */
export interface PartnersScreenProps {
  readonly data: DataLayer;
  readonly toasts: Toasts;
  /** The page's name, as the settings navigation gives it. */
  readonly title: string;
}

const COLUMNS: readonly TableColumn[] = [
  { id: 'name', label: strings.columns.name, isRowHeader: true, isInline: true, phone: 'title' },
  { id: 'clientId', label: strings.columns.clientId, size: 'fit' },
  { id: 'secret', label: strings.columns.secret, size: 'fit', phone: 'hidden' },
  { id: 'created', label: strings.columns.created, size: 'fit', phone: 'hidden' },
  { id: 'actions', label: strings.columns.actions, isLabelHidden: true, align: 'end', size: 'fit', isInline: true },
];

const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
const LOGO_MAX_BYTES = 200 * 1024;

/** One address a line, blank lines dropped. */
const linesOf = (text: string) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');

type Loaded =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly partners: readonly PartnerView[] }
  | { readonly status: 'error'; readonly error: unknown };

/** The Partners page: a Table, Register partner in the head, the form, the secret shown once, and Replace secret. */
export function PartnersScreen({ data, toasts, title }: PartnersScreenProps) {
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' });
  // Read when the page opens (and again on Retry); settings, not CRM data, so nothing holds it between visits.
  const [reads, setReads] = useState(0);
  useEffect(() => {
    let isCurrent = true;
    data.partners.list().then(
      (partners) => {
        if (isCurrent) setLoaded({ status: 'ready', partners });
      },
      (error: unknown) => {
        if (isCurrent) setLoaded({ status: 'error', error });
      },
    );
    return () => {
      isCurrent = false;
    };
  }, [data, reads]);
  const retry = useAdminRetry(() => {
    setLoaded({ status: 'loading' });
    setReads((count) => count + 1);
  });
  // The form: closed, a new partner, or one partner's change. Each opening mounts it afresh.
  const [editing, setEditing] = useState<{ readonly partner?: PartnerView; readonly opening: number } | undefined>();
  const [opening, setOpening] = useState(0);
  const [secret, setSecret] = useState<{ readonly made: PartnerWithSecret; readonly isNew: boolean } | undefined>();
  const [replacing, setReplacing] = useState<PartnerView | undefined>(undefined);

  const landed = (partner: PartnerView) =>
    setLoaded((now) =>
      now.status !== 'ready'
        ? now
        : {
            status: 'ready',
            partners: now.partners.some((each) => each.id === partner.id)
              ? now.partners.map((each) => (each.id === partner.id ? partner : each))
              : [partner, ...now.partners],
          },
    );

  if (loaded.status === 'error') {
    return <AdminFailed title={title} error={loaded.error} data={data} onRetry={retry} />;
  }

  const open = (partner?: PartnerView) => {
    setOpening((count) => count + 1);
    setEditing({ ...(partner === undefined ? {} : { partner }), opening: opening + 1 });
  };

  const cell = (partner: PartnerView, column: string) => {
    switch (column) {
      case 'name':
        return (
          <>
            <Avatar
              name={partner.name}
              size="sm"
              shape="square"
              fit="contain"
              isDecorative
              {...(partner.logoUrl === undefined ? {} : { src: partner.logoUrl })}
            />
            {partner.name}
          </>
        );
      case 'clientId':
        return <Code>{partner.clientId}</Code>;
      case 'secret':
        return <Code>{strings.secretHint(partner.secretHint)}</Code>;
      case 'created':
        return <RelativeTime value={partner.createdAt} />;
      default:
        return (
          <>
            <Button size="sm" label={strings.edit(partner.name)} onPress={() => open(partner)}>
              {strings.editShort}
            </Button>
            <Button size="sm" label={strings.replace(partner.name)} onPress={() => setReplacing(partner)}>
              {strings.replaceShort}
            </Button>
          </>
        );
    }
  };

  return (
    <SettingsPage
      title={title}
      isLoading={loaded.status === 'loading'}
      actions={
        <Button variant="primary" icon="plus" onPress={() => open()}>
          {strings.register}
        </Button>
      }
    >
      {loaded.status === 'ready' && loaded.partners.length === 0 ? (
        <EmptyState icon="handshake" title={strings.emptyTitle}>
          {strings.emptyText}
        </EmptyState>
      ) : (
        <Table
          label={title}
          columns={COLUMNS}
          rows={loaded.status === 'ready' ? loaded.partners : []}
          getRowId={(partner) => partner.id}
          renderCell={cell}
          isLoading={loaded.status === 'loading'}
          isScrollable
          phoneLayout="rows"
        />
      )}
      {editing !== undefined && (
        <PartnerForm
          key={editing.opening}
          data={data}
          {...(editing.partner === undefined ? {} : { partner: editing.partner })}
          onClose={() => setEditing(undefined)}
          onRegistered={(made) => {
            landed(made.partner);
            setEditing(undefined);
            setSecret({ made, isNew: true });
          }}
          onSaved={(partner) => {
            landed(partner);
            setEditing(undefined);
            toasts.toast({ tone: 'success', message: strings.saved(partner.name) });
          }}
        />
      )}
      <ReplaceDialog
        data={data}
        partner={replacing}
        onClose={() => setReplacing(undefined)}
        onReplaced={(made) => {
          landed(made.partner);
          setReplacing(undefined);
          setSecret({ made, isNew: false });
        }}
      />
      <SecretDialog shown={secret} onClose={() => setSecret(undefined)} />
    </SettingsPage>
  );
}

/** Register a partner, or change one: its name, logo and addresses. */
function PartnerForm({
  data,
  partner,
  onClose,
  onRegistered,
  onSaved,
}: {
  readonly data: DataLayer;
  readonly partner?: PartnerView;
  readonly onClose: () => void;
  readonly onRegistered: (made: PartnerWithSecret) => void;
  readonly onSaved: (partner: PartnerView) => void;
}) {
  const formId = useId();
  const [name, setName] = useState(partner?.name ?? '');
  const [frames, setFrames] = useState(partner?.frameOrigins.join('\n') ?? '');
  const [redirects, setRedirects] = useState(partner?.redirectUris.join('\n') ?? '');
  // undefined: unchanged; null: taken away; a logo: the new one.
  const [logo, setLogo] = useState<PartnerLogoUpload | null | undefined>(undefined);
  const [logoPreview, setLogoPreview] = useState<string | undefined>(partner?.logoUrl);
  const [isBusy, setBusy] = useState(false);
  const [refusals, setRefusals] = useState<readonly FormRefusal[]>([]);

  const pickLogo = (files: readonly File[]) => {
    const [file] = files;
    if (file === undefined) return;
    void data.partners.logoFrom(file).then((read) => {
      if (read === undefined) return;
      setLogo(read);
      setLogoPreview(`data:${read.type};base64,${read.data}`);
    });
  };

  const submit = () => {
    if (isBusy) return;
    const problems: FormRefusal[] = [];
    if (name.trim() === '')
      problems.push({ code: 'INPUT_INVALID', message: strings.form.nameMissing, attributeId: 'name' });
    if (linesOf(redirects).length === 0) {
      problems.push({ code: 'INPUT_INVALID', message: strings.form.redirectMissing, attributeId: 'redirectUris' });
    }
    setRefusals(problems);
    if (problems.length > 0) return;
    setBusy(true);
    const fields = { name: name.trim(), frameOrigins: linesOf(frames), redirectUris: linesOf(redirects) };
    const failed = (error: unknown) => {
      setBusy(false);
      setRefusals(formRefusals(error, ['name', 'logo', 'frameOrigins', 'redirectUris']));
    };
    if (partner === undefined) {
      data.partners
        .register({ ...fields, ...(logo === undefined || logo === null ? {} : { logo }) })
        .then(onRegistered, failed);
    } else {
      data.partners
        .update({ partnerId: partner.id, ...fields, ...(logo === undefined ? {} : { logo }) })
        .then(onSaved, failed);
    }
  };

  const errorOf = (field: string) => refusals.find((refusal) => refusal.attributeId === field)?.message;
  const logoError = errorOf('logo');
  const title = partner === undefined ? strings.form.registerTitle : strings.form.editTitle(partner.name);

  return (
    <Modal
      title={title}
      variant="form"
      isOpen
      onOpenChange={(isOpen) => {
        if (!isOpen && !isBusy) onClose();
      }}
      actions={
        <>
          <Button slot="close" isDisabled={isBusy}>
            {strings.form.cancel}
          </Button>
          <Button variant="primary" type="submit" form={formId} isPending={isBusy}>
            {partner === undefined
              ? isBusy
                ? strings.form.registering
                : strings.form.register
              : isBusy
                ? strings.form.saving
                : strings.form.save}
          </Button>
        </>
      }
    >
      <Form
        id={formId}
        label={title}
        isBusy={isBusy}
        refusals={refusals}
        fieldFor={(refusal) => refusal.attributeId}
        onSubmit={submit}
        focusesFirstField
      >
        <Field
          label={strings.form.name}
          placeholder={strings.form.namePlaceholder}
          name="name"
          autoComplete="off"
          isRequired
          maxLength={80}
          value={name}
          onChange={setName}
        />
        <FileDrop
          label={strings.form.logo}
          variant="row"
          acceptedTypes={LOGO_TYPES}
          typesText={strings.form.logoTypes}
          maxSize={LOGO_MAX_BYTES}
          onFiles={pickLogo}
          {...(logoPreview === undefined ? {} : { preview: { src: logoPreview, alt: strings.form.logo } })}
          {...(logoError === undefined ? {} : { error: logoError })}
          // Taken away from the form only: Save makes it so, and Cancel keeps the logo (Save is the confirm).
          onRemove={() => {
            setLogo(null);
            setLogoPreview(undefined);
          }}
        />
        <Field
          label={strings.form.redirectUris}
          hint={strings.form.redirectUrisHint}
          name="redirectUris"
          isMultiline
          isRequired
          type="url"
          value={redirects}
          onChange={setRedirects}
        />
        <Field
          label={strings.form.frameOrigins}
          hint={strings.form.frameOriginsHint}
          name="frameOrigins"
          isMultiline
          type="url"
          value={frames}
          onChange={setFrames}
        />
      </Form>
    </Modal>
  );
}

/** Replace secret, asked first: the old one stops at once. */
function ReplaceDialog({
  data,
  partner,
  onClose,
  onReplaced,
}: {
  readonly data: DataLayer;
  readonly partner: PartnerView | undefined;
  readonly onClose: () => void;
  readonly onReplaced: (made: PartnerWithSecret) => void;
}) {
  const [last, setLast] = useState(partner);
  const [isBusy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  if (partner !== undefined && partner !== last) setLast(partner);
  const shown = partner ?? last;
  if (shown === undefined) return null;
  return (
    <Modal
      title={strings.replaceConfirm.title(shown.name)}
      variant="confirm"
      tone="danger"
      isOpen={partner !== undefined}
      onOpenChange={(isOpen) => {
        if (!isOpen && !isBusy) {
          setFailure(undefined);
          onClose();
        }
      }}
      actions={
        <>
          <Button slot="close" isDisabled={isBusy}>
            {strings.replaceConfirm.cancel}
          </Button>
          <Button
            variant="danger-solid"
            isPending={isBusy}
            onPress={() => {
              setBusy(true);
              setFailure(undefined);
              data.partners.replaceSecret(shown.id).then(
                (made) => {
                  setBusy(false);
                  onReplaced(made);
                },
                (error: unknown) => {
                  setBusy(false);
                  setFailure(isDataError(error) ? error.message : strings.failedTitle);
                },
              );
            }}
          >
            {isBusy ? strings.replaceConfirm.replacing : strings.replaceConfirm.confirm}
          </Button>
        </>
      }
    >
      {failure !== undefined && (
        <Callout tone="danger" isAnnounced>
          {failure}
        </Callout>
      )}
      {strings.replaceConfirm.text}
    </Modal>
  );
}

/** The client id and the whole secret, shown this once with Copy. */
function SecretDialog({
  shown,
  onClose,
}: {
  readonly shown: { readonly made: PartnerWithSecret; readonly isNew: boolean } | undefined;
  readonly onClose: () => void;
}) {
  const [last, setLast] = useState(shown);
  if (shown !== undefined && shown !== last) setLast(shown);
  const showing = shown ?? last;
  if (showing === undefined) return null;
  const { partner, secret } = showing.made;
  return (
    <Modal
      title={showing.isNew ? strings.secret.madeTitle(partner.name) : strings.secret.replacedTitle(partner.name)}
      variant="form"
      isOpen={shown !== undefined}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
      actions={
        <Button variant="primary" slot="close">
          {strings.secret.done}
        </Button>
      }
    >
      <Callout tone="warning">{strings.secret.text}</Callout>
      <DescriptionList
        layout="stacked"
        items={[
          {
            term: strings.secret.clientId,
            description: (
              <Code variant="block" isCopyable copyLabel={strings.secret.copyClientId}>
                {partner.clientId}
              </Code>
            ),
          },
          {
            term: strings.secret.secret,
            description: (
              <Code variant="block" isCopyable copyLabel={strings.secret.copySecret}>
                {secret}
              </Code>
            ),
          },
        ]}
      />
    </Modal>
  );
}

/** The Partners page while its route loads: the head's place and rows where the list will be. */
export function PartnersPending({ title }: { readonly title: string }) {
  return (
    <SettingsPage title={title} isLoading>
      <Table label={title} columns={COLUMNS} rows={[]} getRowId={() => ''} renderCell={() => null} isLoading />
    </SettingsPage>
  );
}
