// Brief
// Purpose: Captures › Forms: the workspace's forms as cards, the same cards as Links, with their enquiries and whether they take more (spec 0023).
// Main task: open a form, make a new one at once, copy its link, or pause and resume it from its menu.
// Leaves out: anything inside one form (its builder), and archived forms (a later pass).
import { isDataError, type FormSummary } from '@crm/data';
import { useCaptureList } from '@crm/data/react';
import { Button, Menu, MenuItem, MenuSeparator, MenuTrigger, Modal, Tooltip, type LinkGridCard } from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { useState } from 'react';
import { CapturesList } from '../captures/CapturesList.tsx';
import { useCapturesCreate } from '../captures/create.tsx';
import { useCan } from '../workspace/WorkspacePage.tsx';
import { formHref } from './paths.ts';
import { strings } from './strings.ts';

/** Props for Captures › Forms: the workspace, whose held list of forms the route loaded. */
export interface FormsScreenProps {
  readonly slug: string;
}

/** A form's facts: its responses, and spam when there is some ("12 responses · 2 spam"). */
function factsOf(form: FormSummary): readonly string[] {
  return [strings.responses(form.submissionCount), ...(form.spamCount > 0 ? [strings.spam(form.spamCount)] : [])];
}

/** Its grey badge: Not published until its first publish. Off needs none (the muted title and the switch say it). */
function badgeOf(form: FormSummary): { readonly badge?: string } {
  return form.liveVersionNumber === undefined ? { badge: strings.notPublishedYet } : {};
}

/** Captures › Forms: New form, then one card per form, newest change first, read from the data layer's held list. */
export function FormsScreen({ slug }: FormsScreenProps) {
  const { data, toasts } = useRouteContext({ from: '__root__' });
  const canManage = useCan('forms.manage');
  const list = useCaptureList(data.forms.view(slug));
  const create = useCapturesCreate();
  const [deleting, setDeleting] = useState<FormSummary | undefined>(undefined);

  // A refusal says what was put back, then why.
  const failed = (what: string) => (error: unknown) => {
    toasts.toast({ tone: 'danger', message: `${what} ${isDataError(error) ? error.message : strings.failedText}` });
  };

  // Each change shows in the list at once; a refusal puts it back there, and the toast says why.
  const setAccepting = (form: FormSummary, isAccepting: boolean) => {
    data.forms
      .setStatus(slug, form.id, isAccepting ? 'live' : 'paused')
      .catch(failed(isAccepting ? strings.turnOnFailed(form.name) : strings.turnOffFailed(form.name)));
  };

  const duplicate = (form: FormSummary) => {
    data.forms.duplicate(slug, form.id).then(
      (copy) => {
        toasts.toast({ tone: 'success', message: strings.duplicated(copy.name) });
      },
      failed(strings.duplicateFailed(form.name)),
    );
  };

  const remove = (form: FormSummary) => {
    setDeleting(undefined);
    data.forms.delete(slug, form.id).then(
      () => {
        toasts.toast({ tone: 'success', message: strings.deleted(form.name) });
      },
      failed(strings.deleteFailed(form.name)),
    );
  };

  const forms = list.status === 'ready' ? list.items : [];
  const cards: readonly LinkGridCard[] = forms.map((form) => {
    const isPending = list.status === 'ready' && list.pendingIds.has(form.id);
    const isPublished = form.liveVersionNumber !== undefined;
    const isLive = isPublished && form.status === 'live';
    return {
      id: form.id,
      title: form.name,
      href: formHref(slug, form.id),
      facts: factsOf(form),
      address: isPending ? strings.addressPending : `/f/${form.publicKey}`,
      ...(isPending ? { badge: strings.copying } : badgeOf(form)),
      isOff: !isLive,
      isPending,
      toggle: {
        label: strings.acceptingOf(form.name),
        isSelected: isLive,
        onChange: (isOn: boolean) => {
          setAccepting(form, isOn);
        },
        isDisabled: !canManage || !isPublished,
        disabledReason: isPublished ? strings.manageOnly : strings.publishFirst,
      },
      // Not published, there is nothing to copy or open: the badge says why.
      ...(isPublished ? { copyValue: data.forms.hostedUrl(form.publicKey) } : {}),
      actions: (
        <>
          {isLive && (
            <Tooltip content={strings.openInNewTab} isDisabled={isPending}>
              <Button
                variant="ghost"
                size="lg"
                icon="external-link"
                label={strings.openForm(form.name)}
                isDisabled={isPending}
                onPress={() => {
                  globalThis.open(data.forms.hostedUrl(form.publicKey), '_blank', 'noopener');
                }}
              />
            </Tooltip>
          )}
          {canManage && (
            <MenuTrigger>
              <Button
                variant="ghost"
                size="lg"
                icon="ellipsis"
                label={strings.moreFor(form.name)}
                isDisabled={isPending}
              />
              <Menu
                label={strings.moreFor(form.name)}
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
      cards={cards}
      // An empty list offers New in its middle too: the same as the TopBar's.
      {...(create?.create === undefined
        ? {}
        : {
            newAction: (
              <Button variant="primary" icon="plus" onPress={create.create} isPending={create.isPending}>
                {strings.newForm}
              </Button>
            ),
          })}
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

/** The list while its forms load, inside the Captures layout: skeleton cards in the cards' shape. */
export function FormsPending() {
  return (
    <CapturesList
      label={strings.forms}
      searchLabel={strings.searchForms}
      status="loading"
      cards={[]}
      empty={{ title: strings.noForms, text: strings.noFormsText, icon: 'clipboard-list' }}
      errorTitle={strings.failedTitle}
      onRetry={() => undefined}
    />
  );
}
