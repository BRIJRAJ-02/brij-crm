// Brief
// Purpose: Captures › Forms: the workspace's forms as rows, the same rows as Links, with their enquiries and whether they take more (spec 0023).
// Main task: open a form, make a new one at once, copy its link, or pause and resume it from its menu.
// Leaves out: anything inside one form (its builder), and archived forms (a later pass).
import { isDataError, type FormSummary } from '@crm/data';
import { useCaptureList } from '@crm/data/react';
import { Button, CopyButton, Menu, MenuItem, MenuSeparator, MenuTrigger, Modal, type LinkRow } from '@crm/ui';
import { useNavigate, useRouteContext } from '@tanstack/react-router';
import { useState } from 'react';
import { CapturesList } from '../captures/CapturesList.tsx';
import { useCan } from '../workspace/WorkspacePage.tsx';
import { formHref } from './paths.ts';
import { strings } from './strings.ts';

/** Props for Captures › Forms: the workspace, whose held list of forms the route loaded. */
export interface FormsScreenProps {
  readonly slug: string;
}

/** "Tue, Sep 1 · 1:44 PM", in the reader's language. */
function when(iso: string): string {
  const date = new Date(iso);
  const day = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).format(date);
  const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date);
  return `${day} · ${time}`;
}

/** A form's chips: its responses, spam when there is some, and the last enquiry. */
function chipsOf(form: FormSummary): readonly string[] {
  return [
    strings.responses(form.submissionCount),
    ...(form.spamCount > 0 ? [strings.spam(form.spamCount)] : []),
    ...(form.lastSubmissionAt === undefined ? [] : [strings.lastEnquiry(when(form.lastSubmissionAt))]),
  ];
}

/** Its grey badge, only when it isn't taking enquiries: Not published until its first publish, then Paused. */
function badgeOf(form: FormSummary): { readonly badge?: string } {
  if (form.liveVersionNumber === undefined) return { badge: strings.notPublishedYet };
  return form.status === 'paused' ? { badge: strings.pausedTag } : {};
}

/** Captures › Forms: New form, then one row per form, newest change first, read from the data layer's held list. */
export function FormsScreen({ slug }: FormsScreenProps) {
  const { data, toasts } = useRouteContext({ from: '__root__' });
  const navigate = useNavigate();
  const canManage = useCan('forms.manage');
  const list = useCaptureList(data.forms.view(slug));
  const [creating, setCreating] = useState<string | undefined>(undefined);
  const [deleting, setDeleting] = useState<FormSummary | undefined>(undefined);

  const failed = (error: unknown) => {
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

  // Each change shows in the list at once; a refusal puts it back there, and the toast says why.
  const setAccepting = (form: FormSummary, isAccepting: boolean) => {
    data.forms.setStatus(slug, form.id, isAccepting ? 'live' : 'paused').catch(failed);
  };

  const duplicate = (form: FormSummary) => {
    data.forms.duplicate(slug, form.id).catch(failed);
  };

  const remove = (form: FormSummary) => {
    setDeleting(undefined);
    data.forms.delete(slug, form.id).then(() => {
      toasts.toast({ tone: 'success', message: strings.deleted(form.name) });
    }, failed);
  };

  const forms = list.status === 'ready' ? list.items : [];
  const rows: readonly LinkRow[] = forms.map((form) => {
    const isPending = list.status === 'ready' && list.pendingIds.has(form.id);
    const isPublished = form.liveVersionNumber !== undefined;
    return {
      id: form.id,
      title: form.name,
      address: isPending ? strings.addressPending : `/f/${form.publicKey}`,
      chips: chipsOf(form),
      ...badgeOf(form),
      toggle: {
        label: strings.acceptingOf(form.name),
        isSelected: isPublished && form.status === 'live',
        onChange: (isOn: boolean) => {
          setAccepting(form, isOn);
        },
        isDisabled: !canManage || !isPublished,
      },
      isPending,
      actions: (
        <>
          <Button
            variant="ghost"
            icon="external-link"
            label={strings.openForm(form.name)}
            isDisabled={isPending || !isPublished}
            onPress={() => {
              globalThis.open(data.forms.hostedUrl(form.publicKey), '_blank', 'noopener');
            }}
          />
          <CopyButton
            value={data.forms.hostedUrl(form.publicKey)}
            label={strings.copyLinkTo(form.name)}
            isIconOnly
            variant="ghost"
            isDisabled={isPending || !isPublished}
          />
          {canManage && (
            <MenuTrigger>
              <Button variant="ghost" icon="ellipsis" label={strings.formActions(form.name)} isDisabled={isPending} />
              <Menu
                label={strings.formActions(form.name)}
                onAction={(key) => {
                  if (key === 'duplicate') duplicate(form);
                  if (key === 'delete') setDeleting(form);
                }}
              >
                <MenuItem id="duplicate" icon="copy">
                  {strings.duplicate}
                </MenuItem>
                <MenuSeparator />
                <MenuItem id="delete" icon="trash" isDanger>
                  {strings.delete}
                </MenuItem>
              </Menu>
            </MenuTrigger>
          )}
        </>
      ),
    };
  });

  return (
    <CapturesList
      label={strings.forms}
      searchLabel={strings.searchForms}
      status={list.status}
      rows={rows}
      onOpen={open}
      {...(canManage
        ? {
            newAction: (
              <Button variant="primary" icon="plus" onPress={create} isPending={creating !== undefined}>
                {creating === undefined ? strings.newForm : strings.creating}
              </Button>
            ),
          }
        : {})}
      empty={{ title: strings.noForms, text: strings.noFormsText, icon: 'clipboard-list' }}
      errorTitle={strings.failedTitle}
      onRetry={() => {
        data.forms.view(slug).reload();
      }}
      dialogs={<DeleteFormDialog form={deleting} onClose={() => setDeleting(undefined)} onDelete={remove} />}
    />
  );
}

/** Delete “<name>”?: its address stops working and its submissions go; the row leaves at once, back on a refusal. */
function DeleteFormDialog({
  form,
  onClose,
  onDelete,
}: {
  readonly form: FormSummary | undefined;
  readonly onClose: () => void;
  readonly onDelete: (form: FormSummary) => void;
}) {
  // The last form stays while the Modal plays its exit.
  const [last, setLast] = useState(form);
  if (form !== undefined && form !== last) setLast(form);
  const shown = form ?? last;
  if (shown === undefined) return null;
  return (
    <Modal
      title={strings.deleteTitle(shown.name)}
      tone="danger"
      isOpen={form !== undefined}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
      actions={
        <>
          <Button slot="close" kbd="ESC">
            {strings.cancel}
          </Button>
          <Button
            variant="danger-solid"
            icon="trash"
            onPress={() => {
              onDelete(shown);
            }}
          >
            {strings.delete}
          </Button>
        </>
      }
    >
      {strings.deleteText(shown.submissionCount)}
    </Modal>
  );
}

/** The list while its forms load, inside the Captures layout: skeleton rows in the rows' shape. */
export function FormsPending() {
  return (
    <CapturesList
      label={strings.forms}
      searchLabel={strings.searchForms}
      status="loading"
      rows={[]}
      onOpen={() => undefined}
      empty={{ title: strings.noForms, text: strings.noFormsText, icon: 'clipboard-list' }}
      errorTitle={strings.failedTitle}
      onRetry={() => undefined}
    />
  );
}
