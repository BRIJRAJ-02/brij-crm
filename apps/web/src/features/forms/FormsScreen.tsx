// Brief
// Purpose: Captures › Forms: the workspace's forms as cards, the same cards as Links, with their submissions and whether they take more (spec 0023).
// Main task: open a form, make a new one at once, copy its link, or pause and resume it from its switch.
// Leaves out: anything inside one form (its builder), and archived forms (a later pass).
import { isDataError, type FormSummary } from '@crm/data';
import { useCaptureList } from '@crm/data/react';
import { Button, focusLater, Menu, MenuItem, MenuSeparator, MenuTrigger, Tooltip, type LinkGridCard } from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { useState } from 'react';
import { CapturesList } from '../captures/CapturesList.tsx';
import { useCapturesCreate } from '../captures/create.tsx';
import { pageHeading } from '../navigation/focus.ts';
import { useCan } from '../workspace/WorkspacePage.tsx';
import { DeleteFormDialog, PauseFormDialog } from './FormConfirms.tsx';
import { formHref } from './paths.ts';
import { strings } from './strings.ts';

/** Props for Captures › Forms: the workspace, whose held list of forms the route loaded. */
export interface FormsScreenProps {
  readonly slug: string;
}

/**
 * A form's facts: what to do first while it is a draft; then its submissions, with spam when there is some
 * ("12 submissions · 2 spam"), or "No submissions yet".
 */
function factsOf(form: FormSummary): readonly string[] {
  if (form.liveVersionNumber === undefined) return [strings.publishToShare];
  if (form.submissionCount === 0) return [strings.noSubmissionsYet];
  return [strings.submissionCount(form.submissionCount), ...(form.spamCount > 0 ? [strings.spam(form.spamCount)] : [])];
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
  // Turning a live form off asks first (it ends its submissions); turning one on is one click.
  const [pausing, setPausing] = useState<FormSummary | undefined>(undefined);

  // A refusal says what was put back, then why.
  const failed = (what: string) => (error: unknown) => {
    toasts.toast({ tone: 'danger', message: `${what} ${isDataError(error) ? error.message : strings.failedText}` });
  };

  // Turning one on shows in the list at once; a refusal puts it back there, and the toast says why.
  const resume = (form: FormSummary) => {
    data.forms.setStatus(slug, form.id, 'live').catch(failed(strings.turnOnFailed(form.name)));
  };

  const duplicate = (form: FormSummary) => {
    data.forms.duplicate(slug, form.id).then(
      (copy) => {
        toasts.toast({ tone: 'success', message: strings.duplicated(copy.name) });
      },
      failed(strings.duplicateFailed(form.name)),
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
      // Each form keeps one colour, picked from its id, as a booking page does.
      colourKey: form.id,
      facts: factsOf(form),
      // A draft has no link yet: its generated address only becomes real on the first publish.
      ...(isPending ? { address: strings.addressPending } : isPublished ? { address: `/f/${form.publicKey}` } : {}),
      ...(isPending ? { badge: strings.copying } : badgeOf(form)),
      isOff: !isLive,
      isPending,
      // Accepting is a published form's: a draft shows no switch, its badge and facts say what to do.
      ...(isPublished || isPending
        ? {
            toggle: {
              label: strings.acceptingOf(form.name),
              isSelected: isLive,
              onChange: (isOn: boolean) => {
                if (isOn) resume(form);
                else setPausing(form);
              },
              isDisabled: !canManage,
              disabledReason: strings.manageOnly,
              hint: isLive ? strings.accepting : strings.notAccepting,
            },
          }
        : {}),
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
      dialogs={
        <>
          <DeleteFormDialog
            data={data}
            slug={slug}
            form={deleting}
            onClose={() => setDeleting(undefined)}
            onDone={(form) => {
              setDeleting(undefined);
              toasts.toast({ tone: 'success', message: strings.deleted(form.name) });
              // The card and its menu went with the form: focus goes to the page's title rather than to a card
              // that is about to leave, or to the page.
              focusLater(() => pageHeading(document));
            }}
          />
          <PauseFormDialog
            data={data}
            slug={slug}
            form={pausing}
            onClose={() => setPausing(undefined)}
            onDone={(form) => {
              setPausing(undefined);
              toasts.toast({ tone: 'success', message: strings.paused(form.name) });
            }}
          />
        </>
      }
    />
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
