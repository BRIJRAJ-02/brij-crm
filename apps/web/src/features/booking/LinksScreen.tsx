// Brief
// Purpose: Captures › Links (spec 0025, 0025-experience.md, AC-645): the member's booking pages as cards (an admin sees everyone's), the same cards as Forms.
// Main task: open a page, copy its link, or make a new one in the dialog and land in its editor.
// Leaves out: editing a page (its editor), forms (their own tab) and the bookings list (Bookings).
import { isDataError, type BookingPageView, type DataLayer } from '@crm/data';
import { useCaptureList } from '@crm/data/react';
import { Button, Menu, MenuItem, MenuSeparator, MenuTrigger, Modal, Tooltip, type LinkGridCard } from '@crm/ui';
import { useNavigate, useRouteContext } from '@tanstack/react-router';
import { useState } from 'react';
import { CapturesList } from '../captures/CapturesList.tsx';
import { pageEditorHref, publicBookingUrl } from './links.ts';
import { NewPageDialog } from './NewPageDialog.tsx';
import { strings } from './strings.ts';

/** Props for the list: the data layer, whose held list of pages the route loaded. */
export interface LinksScreenProps {
  readonly data: DataLayer;
  readonly slug: string;
}

/** A page's facts: its lengths, its kind, own hours, and a location that isn't video ("30 or 60 min · One on one"). */
function factsOf(page: BookingPageView): readonly string[] {
  return [
    ...(page.durations.length === 0 ? [] : [strings.minutesChoice(page.durations)]),
    strings.kindLabel[page.kind],
    ...(page.hoursMode === 'own' ? [strings.ownHours] : []),
    ...(page.location.type === 'video' ? [] : [strings.locationChip[page.location.type]]),
  ];
}

/** The cards, New booking page, and each card's switch, Copy link, Open and menu, read from the data layer's held list. */
export function LinksScreen({ data, slug }: LinksScreenProps) {
  const { toasts } = useRouteContext({ from: '__root__' });
  const navigate = useNavigate();
  const list = useCaptureList(data.bookingPages.view(slug));
  const [isCreating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<BookingPageView | undefined>(undefined);
  // A refusal says what was put back, then why.
  const failed = (what: string) => (error: unknown) => {
    toasts.toast({ tone: 'danger', message: `${what} ${isDataError(error) ? error.message : strings.somethingWrong}` });
  };
  const open = (pageId: string, hash?: string) =>
    void navigate({ to: pageEditorHref(slug, pageId), ...(hash === undefined ? {} : { hash }) });
  // Each change shows in the list at once; a refusal puts it back there, and the toast says why.
  const setStatus = (page: BookingPageView, status: 'live' | 'paused') => {
    data.bookingPages
      .update(slug, page.id, { status })
      .catch(failed(status === 'paused' ? strings.turnOffFailed(page.title) : strings.turnOnFailed(page.title)));
  };
  const duplicate = (page: BookingPageView) => {
    data.bookingPages.duplicate(slug, page, strings.copyOf(page.title)).then(
      (copy) => {
        toasts.toast({ tone: 'success', message: strings.duplicated(copy.title) });
      },
      failed(strings.duplicateFailed(page.title)),
    );
  };
  const remove = (page: BookingPageView) => {
    setDeleting(undefined);
    data.bookingPages.remove(slug, page.id).then(
      () => {
        toasts.toast({ tone: 'success', message: strings.deleted(page.title) });
      },
      failed(strings.deleteFailed(page.title)),
    );
  };
  const pages = list.status === 'ready' ? list.items : [];
  const cards: readonly LinkGridCard[] = pages.map((page) => {
    const isPending = list.status === 'ready' && list.pendingIds.has(page.id);
    const isOff = page.status === 'paused';
    return {
      id: page.id,
      title: page.title,
      href: pageEditorHref(slug, page.id),
      // Pages have no colour of their own yet: the card takes a stable one from the page's id.
      colourKey: page.id,
      facts: factsOf(page),
      // The link Copy link copies, as a path.
      address: new URL(publicBookingUrl(page.publicKey)).pathname,
      // Off shows in the muted title and the switch; the badge is for what they can't say.
      ...(isPending ? { badge: strings.copying } : page.isPrivate ? { badge: strings.private } : {}),
      isOff,
      isPending,
      toggle: {
        label: strings.isOn(page.title),
        isSelected: page.status === 'live',
        onChange: (isOn: boolean) => {
          setStatus(page, isOn ? 'live' : 'paused');
        },
        isDisabled: !page.canChange,
        disabledReason: strings.notYours,
      },
      copyValue: publicBookingUrl(page.publicKey),
      actions: (
        <>
          {/* Off, there is nothing to open: the muted title and the switch say why. */}
          {!isOff && (
            <Tooltip content={strings.openInNewTab} isDisabled={isPending}>
              <Button
                variant="ghost"
                size="lg"
                icon="external-link"
                label={strings.openPage(page.title)}
                isDisabled={isPending}
                onPress={() => {
                  globalThis.open(publicBookingUrl(page.publicKey), '_blank', 'noopener');
                }}
              />
            </Tooltip>
          )}
          {page.canChange && (
            <MenuTrigger>
              <Button
                variant="ghost"
                size="lg"
                icon="ellipsis"
                label={strings.more(page.title)}
                isDisabled={isPending}
              />
              <Menu
                label={strings.more(page.title)}
                onAction={(key) => {
                  if (key === 'duplicate') duplicate(page);
                  if (key === 'hours') open(page.id, 'hours');
                  if (key === 'delete') setDeleting(page);
                }}
              >
                <MenuItem id="duplicate" icon="copy">
                  {strings.duplicate}
                </MenuItem>
                <MenuItem id="hours" icon="clock">
                  {strings.hours}
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
      label={strings.listLabel}
      searchLabel={strings.searchPages}
      status={list.status}
      cards={cards}
      newAction={
        <Button variant="primary" icon="plus" label={strings.newPage} onPress={() => setCreating(true)}>
          {strings.newButton}
        </Button>
      }
      empty={{ title: strings.emptyTitle, text: strings.emptyText, icon: 'calendar-clock' }}
      errorTitle={strings.failedTitle}
      onRetry={() => {
        data.bookingPages.view(slug).reload();
      }}
      dialogs={
        <>
          <NewPageDialog
            data={data}
            slug={slug}
            isOpen={isCreating}
            onClose={() => setCreating(false)}
            onCreated={(page) => {
              setCreating(false);
              open(page.id);
            }}
          />
          <DeletePageDialog page={deleting} onClose={() => setDeleting(undefined)} onDelete={remove} />
        </>
      }
    />
  );
}

/** Delete <title>?: its link stops working (AC-648); its bookings stay. The row leaves at once, back on a refusal. */
function DeletePageDialog({
  page,
  onClose,
  onDelete,
}: {
  readonly page: BookingPageView | undefined;
  readonly onClose: () => void;
  readonly onDelete: (page: BookingPageView) => void;
}) {
  // The last page stays while the Modal plays its exit.
  const [last, setLast] = useState(page);
  if (page !== undefined && page !== last) setLast(page);
  const shown = page ?? last;
  if (shown === undefined) return null;
  return (
    <Modal
      title={strings.deleteTitle(shown.title)}
      tone="danger"
      isOpen={page !== undefined}
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
            {strings.deleteAction}
          </Button>
        </>
      }
    >
      {strings.deleteText}
    </Modal>
  );
}

/** The list while its pages load, inside the Captures layout: skeleton cards in the cards' shape. */
export function LinksPending() {
  return (
    <CapturesList
      label={strings.listLabel}
      searchLabel={strings.searchPages}
      status="loading"
      cards={[]}
      empty={{ title: strings.emptyTitle, text: strings.emptyText, icon: 'calendar-clock' }}
      errorTitle={strings.failedTitle}
      onRetry={() => undefined}
    />
  );
}
