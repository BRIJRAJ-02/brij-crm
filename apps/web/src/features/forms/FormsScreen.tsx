// Brief
// Purpose: Captures, Forms: the workspace's forms as cards, with their enquiries and whether they accept more (spec 0023).
// Main task: open a form, make a new one at once, or pause and resume one with its Accepting switch.
// Leaves out: anything inside one form (its builder), and archived forms (a later pass).
import { isDataError, type FormSummary } from '@crm/data';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  FormEditorLayout,
  Link,
  Menu,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  Modal,
  Switch,
  TopBar,
} from '@crm/ui';
import { useNavigate, useRouter, useRouteContext } from '@tanstack/react-router';
import { useState } from 'react';
import { useCan, WorkspacePage } from '../workspace/WorkspacePage.tsx';
import { formHref } from './paths.ts';
import { strings } from './strings.ts';

/** Props for Captures, Forms: what its route loaded through the data layer. */
export interface FormsScreenProps {
  readonly slug: string;
  readonly forms: readonly FormSummary[];
}

/** "Tue, Sep 1 · 1:44 PM", in the reader's language. */
function when(iso: string): string {
  const date = new Date(iso);
  const day = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).format(date);
  const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date);
  return `${day} · ${time}`;
}

/** Captures, Forms: New form, then one card per form, newest change first. */
export function FormsScreen({ slug, forms }: FormsScreenProps) {
  const { data, toasts } = useRouteContext({ from: '__root__' });
  const navigate = useNavigate();
  const router = useRouter();
  const canManage = useCan('forms.manage');
  const [creating, setCreating] = useState<string | undefined>(undefined);
  const [deleting, setDeleting] = useState<FormSummary | undefined>(undefined);
  const [busy, setBusy] = useState<string | undefined>(undefined);

  const failed = (error: unknown) => {
    setBusy(undefined);
    toasts.toast({ tone: 'danger', message: isDataError(error) ? error.message : strings.failedText });
  };

  const open = (formId: string) => {
    void navigate({ href: formHref(slug, formId) });
  };

  // New form makes "Untitled form" at once and opens it: no dialog first, the builder is the dialog.
  const create = () => {
    if (creating !== undefined) return;
    const id = data.forms.newId();
    setCreating(id);
    data.forms.create(slug, { id }).then(
      (form) => {
        setCreating(undefined);
        open(form.id);
      },
      (error: unknown) => {
        setCreating(undefined);
        failed(error);
      },
    );
  };

  const setAccepting = (form: FormSummary, isAccepting: boolean) => {
    setBusy(form.id);
    data.forms.setStatus(slug, form.id, isAccepting ? 'live' : 'paused').then(() => {
      setBusy(undefined);
      toasts.toast({ tone: 'success', message: isAccepting ? strings.resumed(form.name) : strings.paused(form.name) });
      void router.invalidate();
    }, failed);
  };

  const copyAddress = (form: FormSummary) => {
    void navigator.clipboard.writeText(data.forms.hostedUrl(form.publicKey)).then(
      () => {
        toasts.toast({ tone: 'success', message: strings.addressCopied });
      },
      () => undefined,
    );
  };

  const duplicate = (form: FormSummary) => {
    setBusy(form.id);
    data.forms.duplicate(slug, form.id).then((copy) => {
      setBusy(undefined);
      toasts.toast({ tone: 'success', message: strings.duplicated(copy.name) });
      void router.invalidate();
    }, failed);
  };

  const remove = (form: FormSummary) => {
    setBusy(form.id);
    data.forms.delete(slug, form.id).then(() => {
      setBusy(undefined);
      setDeleting(undefined);
      toasts.toast({ tone: 'success', message: strings.deleted(form.name) });
      void router.invalidate();
    }, failed);
  };

  const newForm = (
    <Button variant="primary" icon="plus" onPress={create} isPending={creating !== undefined}>
      {creating === undefined ? strings.newForm : strings.creating}
    </Button>
  );

  const cards =
    forms.length === 0 ? (
      <EmptyState icon="clipboard-list" title={strings.noForms} {...(canManage ? { actions: newForm } : {})}>
        {strings.noFormsText}
      </EmptyState>
    ) : (
      forms.map((form) => {
        const isPublished = form.liveVersionNumber !== undefined;
        const isAccepting = form.status === 'live';
        return (
          <Card
            key={form.id}
            title={form.name}
            actions={
              <>
                {isPublished ? (
                  <Switch
                    label={strings.accepting}
                    isSelected={isAccepting}
                    isDisabled={!canManage || busy === form.id}
                    onChange={(next) => {
                      setAccepting(form, next);
                    }}
                  />
                ) : (
                  <Badge text={strings.notPublishedYet} />
                )}
                <MenuTrigger>
                  <Button variant="ghost" icon="ellipsis" label={strings.formActions(form.name)} />
                  <Menu
                    label={strings.formActions(form.name)}
                    onAction={(key) => {
                      if (key === 'open') open(form.id);
                      if (key === 'copy') copyAddress(form);
                      if (key === 'duplicate') duplicate(form);
                      if (key === 'delete') setDeleting(form);
                    }}
                  >
                    <MenuItem id="open" icon="arrow-right">
                      {strings.open}
                    </MenuItem>
                    <MenuItem id="copy" icon="copy" isDisabled={!isPublished}>
                      {strings.copyAddress}
                    </MenuItem>
                    {canManage && (
                      <MenuItem id="duplicate" icon="layers">
                        {strings.duplicate}
                      </MenuItem>
                    )}
                    {canManage && <MenuSeparator />}
                    {canManage && (
                      <MenuItem id="delete" icon="trash" isDanger>
                        {strings.delete}
                      </MenuItem>
                    )}
                  </Menu>
                </MenuTrigger>
              </>
            }
            footer={<Link href={formHref(slug, form.id)}>{strings.open}</Link>}
          >
            <Badge text={strings.thisMonth(form.submissionsThisMonth)} />{' '}
            {form.spamCount > 0 && (
              <>
                <Badge text={strings.spam(form.spamCount)} />{' '}
              </>
            )}
            {form.lastSubmissionAt !== undefined && <Badge text={strings.lastEnquiry(when(form.lastSubmissionAt))} />}
          </Card>
        );
      })
    );

  return (
    <WorkspacePage
      page={{
        topBar: (
          <TopBar title={strings.forms} icon="clipboard-list">
            {canManage && forms.length > 0 ? newForm : null}
          </TopBar>
        ),
        body: (
          <FormEditorLayout>
            {cards}
            <Modal
              title={deleting === undefined ? strings.deleteForm : strings.deleteTitle(deleting.name)}
              tone="danger"
              isOpen={deleting !== undefined}
              onOpenChange={(isOpen) => {
                if (!isOpen && busy === undefined) setDeleting(undefined);
              }}
              actions={
                <>
                  <Button slot="close" isDisabled={busy !== undefined}>
                    {strings.cancel}
                  </Button>
                  <Button
                    variant="danger-solid"
                    isPending={busy !== undefined}
                    onPress={() => {
                      if (deleting !== undefined) remove(deleting);
                    }}
                  >
                    {strings.delete}
                  </Button>
                </>
              }
            >
              <p>{strings.deleteText(deleting?.submissionCount ?? 0)}</p>
            </Modal>
          </FormEditorLayout>
        ),
      }}
    />
  );
}
