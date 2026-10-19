// Brief
// Purpose: Captures › Links (spec 0025, 0025-experience.md, AC-645): the member's booking pages as rows (an admin sees everyone's).
// Main task: open a page, copy its link, or make a new one in the side panel and land in its editor.
// Leaves out: editing a page (its editor), forms' links (spec 0023 joins this list) and the bookings list (Bookings).
import { isDataError, type BookingPageView, type DataLayer } from '@crm/data';
import {
  Button,
  Callout,
  CopyButton,
  EmptyState,
  LinkList,
  Menu,
  MenuItem,
  MenuSection,
  MenuSeparator,
  MenuTrigger,
  Modal,
  PageColumn,
  Skeleton,
  TopBar,
  type LinkRow,
} from '@crm/ui';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { WorkspacePage } from '../workspace/WorkspacePage.tsx';
import { pageEditorHref, publicBookingUrl } from './links.ts';
import { NewPagePanel } from './NewPagePanel.tsx';
import { strings } from './strings.ts';

/** Props for the list: what its route loaded through the data layer. */
export interface LinksScreenProps {
  readonly data: DataLayer;
  readonly slug: string;
  readonly pages: readonly BookingPageView[];
}

/** A page's chips: its lengths, own hours, and a location that isn't video. */
function chipsOf(page: BookingPageView): readonly string[] {
  return [
    ...page.durations.map((minutes) => strings.minutesShort(minutes)),
    ...(page.hoursMode === 'own' ? [strings.ownHours] : []),
    ...(page.location.type === 'video' ? [] : [strings.locationChip[page.location.type]]),
  ];
}

/** The rows, New booking page, and each row's Copy link and menu. */
export function LinksScreen({ data, slug, pages: loaded }: LinksScreenProps) {
  const navigate = useNavigate();
  const [pages, setPages] = useState(loaded);
  const [isCreating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<BookingPageView | undefined>(undefined);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const replace = (page: BookingPageView) =>
    setPages((current) => current.map((each) => (each.id === page.id ? page : each)));
  const open = (pageId: string, hash?: string) =>
    void navigate({ to: pageEditorHref(slug, pageId), ...(hash === undefined ? {} : { hash }) });
  const setStatus = (page: BookingPageView, status: 'live' | 'paused') => {
    setFailure(undefined);
    // Shown at once; the server's answer replaces it, a refusal puts it back.
    replace({ ...page, status });
    data.bookingPages.update(slug, page.id, { status }).then(replace, (error: unknown) => {
      replace(page);
      setFailure(isDataError(error) ? error.message : strings.somethingWrong);
    });
  };
  const duplicate = (page: BookingPageView) => {
    setFailure(undefined);
    const {
      id: _id,
      publicKey: _key,
      kind: _kind,
      ownerMemberId: _owner,
      bookingsThisMonth: _count,
      canChange: _can,
      createdAt: _created,
      updatedAt: _updated,
      slug: _slug,
      ...settings
    } = page;
    data.bookingPages
      .create(slug, {
        id: data.bookingPages.newId(),
        title: strings.copyOf(page.title),
        timeZone: page.availability.timeZone,
        settings: { ...settings, title: strings.copyOf(page.title) },
      })
      .then(
        (copy) => setPages((current) => [copy, ...current]),
        (error: unknown) => setFailure(isDataError(error) ? error.message : strings.somethingWrong),
      );
  };
  const rows: readonly LinkRow[] = pages.map((page) => ({
    id: page.id,
    title: page.title,
    ...(page.status === 'paused' ? { tag: strings.offTag } : {}),
    address: `/b/${page.publicKey}`,
    chips: chipsOf(page),
    actions: (
      <>
        <CopyButton
          value={publicBookingUrl(page.publicKey)}
          label={strings.copyLinkTo(page.title)}
          isIconOnly
          variant="ghost"
        />
        <MenuTrigger>
          <Button variant="ghost" icon="ellipsis" label={strings.more(page.title)} />
          <Menu
            label={strings.more(page.title)}
            onAction={(key) => {
              if (key === 'tab') globalThis.open(publicBookingUrl(page.publicKey), '_blank', 'noopener');
              if (key === 'on') setStatus(page, 'live');
              if (key === 'off') setStatus(page, 'paused');
              if (key === 'duplicate') duplicate(page);
              if (key === 'hours') open(page.id, 'hours');
              if (key === 'delete') setDeleting(page);
            }}
          >
            <MenuItem id="tab" icon="external-link">
              {strings.openNewTab}
            </MenuItem>
            {page.canChange && (
              <>
                <MenuSection label={strings.visibility}>
                  <MenuItem id="on" icon={page.status === 'live' ? 'check' : undefined}>
                    {strings.on}
                  </MenuItem>
                  <MenuItem id="off" icon={page.status === 'paused' ? 'check' : undefined}>
                    {strings.off}
                  </MenuItem>
                </MenuSection>
                <MenuSeparator />
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
              </>
            )}
          </Menu>
        </MenuTrigger>
      </>
    ),
  }));
  return (
    <WorkspacePage
      page={{
        topBar: (
          <TopBar title={strings.linksTitle} icon="link">
            <Button variant="primary" icon="plus" onPress={() => setCreating(true)}>
              {strings.newPage}
            </Button>
          </TopBar>
        ),
        body: (
          <PageColumn>
            {failure !== undefined && <Callout tone="danger">{failure}</Callout>}
            <LinkList
              label={strings.listLabel}
              rows={rows}
              onOpen={(id) => open(id)}
              emptyState={
                <EmptyState
                  title={strings.emptyTitle}
                  icon="calendar-clock"
                  actions={
                    <Button variant="primary" icon="plus" onPress={() => setCreating(true)}>
                      {strings.newPage}
                    </Button>
                  }
                >
                  {strings.emptyText}
                </EmptyState>
              }
            />
            <NewPagePanel
              data={data}
              slug={slug}
              isOpen={isCreating}
              onClose={() => setCreating(false)}
              onCreated={(page) => {
                setCreating(false);
                open(page.id);
              }}
            />
            <DeletePageDialog
              data={data}
              slug={slug}
              page={deleting}
              onClose={() => setDeleting(undefined)}
              onDeleted={(pageId) => {
                setDeleting(undefined);
                setPages((current) => current.filter((page) => page.id !== pageId));
              }}
            />
          </PageColumn>
        ),
      }}
    />
  );
}

/** Delete <title>?: its link stops working (AC-648); its bookings stay. */
function DeletePageDialog({
  data,
  slug,
  page,
  onClose,
  onDeleted,
}: {
  readonly data: DataLayer;
  readonly slug: string;
  readonly page: BookingPageView | undefined;
  readonly onClose: () => void;
  readonly onDeleted: (pageId: string) => void;
}) {
  // The last page stays while the Modal plays its exit.
  const [last, setLast] = useState(page);
  if (page !== undefined && page !== last) setLast(page);
  const shown = page ?? last;
  const [isBusy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  if (shown === undefined) return null;
  const remove = () => {
    if (isBusy) return;
    setBusy(true);
    setFailure(undefined);
    data.bookingPages.remove(slug, shown.id).then(
      () => {
        setBusy(false);
        onDeleted(shown.id);
      },
      (error: unknown) => {
        setBusy(false);
        setFailure(isDataError(error) ? error.message : strings.somethingWrong);
      },
    );
  };
  return (
    <Modal
      title={strings.deleteTitle(shown.title)}
      tone="danger"
      isOpen={page !== undefined}
      onOpenChange={(isOpen) => {
        if (!isOpen && !isBusy) onClose();
      }}
      actions={
        <>
          <Button slot="close" isDisabled={isBusy} kbd="ESC">
            {strings.cancel}
          </Button>
          <Button variant="danger-solid" icon="trash" isPending={isBusy} onPress={remove}>
            {isBusy ? strings.deleting : strings.deleteAction}
          </Button>
        </>
      }
    >
      {failure !== undefined && <Callout tone="danger">{failure}</Callout>}
      {strings.deleteText}
    </Modal>
  );
}

/** The list while its pages load: the frame, the header and an empty column. */
export function LinksPending() {
  return (
    <WorkspacePage
      page={{
        topBar: <TopBar title={strings.linksTitle} icon="link" isLoading />,
        body: (
          <PageColumn>
            <Skeleton lines={6} />
          </PageColumn>
        ),
      }}
    />
  );
}
