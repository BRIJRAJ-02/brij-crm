// Brief
// Purpose: Settings › Booking pages (spec 0025, AC-645): the member's pages (an admin sees everyone's) with their link, status and bookings this month.
// Main task: make a page and open its builder; copy a link, pause or take bookings again, delete one after a confirm.
// Leaves out: editing a page's settings (its builder), the bookings list (milestone 2) and team pages (milestone 3).
import { isDataError, type BookingPageView, type DataLayer } from '@crm/data';
import { Badge, Button, Callout, CopyButton, EmptyState, Field, Modal, Table, type TableColumn } from '@crm/ui';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { settingsCrumbs, SettingsPage } from '../settings/SettingsPage.tsx';
import { bookingPageHref, publicBookingUrl } from './links.ts';
import { strings } from './strings.ts';

/** Props for the list: what its route loaded through the data layer. */
export interface BookingPagesScreenProps {
  readonly data: DataLayer;
  readonly slug: string;
  readonly pages: readonly BookingPageView[];
}

const COLUMNS: readonly TableColumn[] = [
  { id: 'title', label: strings.columns.title, isRowHeader: true },
  { id: 'status', label: strings.columns.status },
  { id: 'bookings', label: strings.columns.bookings, align: 'end' },
  { id: 'actions', label: strings.columns.actions, isLabelHidden: true, align: 'end' },
];

/** The browser's zone: a new page's hours start in it. */
const browserZone = (): string => new Intl.DateTimeFormat().resolvedOptions().timeZone;

/** The list of pages, New booking page, and each row's actions. */
export function BookingPagesScreen({ data, slug, pages: loaded }: BookingPagesScreenProps) {
  const navigate = useNavigate();
  const [pages, setPages] = useState(loaded);
  const [isCreating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<BookingPageView | undefined>(undefined);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const replace = (page: BookingPageView) =>
    setPages((current) => current.map((each) => (each.id === page.id ? page : each)));
  const setStatus = (page: BookingPageView, status: 'live' | 'paused') => {
    setFailure(undefined);
    // Shown at once; the server's answer replaces it, a refusal puts it back.
    replace({ ...page, status });
    data.bookingPages.update(slug, page.id, { status }).then(replace, (error: unknown) => {
      replace(page);
      setFailure(isDataError(error) ? error.message : strings.somethingWrong);
    });
  };
  const open = (pageId: string) => void navigate({ to: bookingPageHref(slug, pageId) });
  return (
    <SettingsPage
      title={strings.title}
      crumbs={settingsCrumbs(slug, 'objects')}
      description={strings.description}
      current="booking-pages"
      actions={
        <Button variant="primary" icon="plus" onPress={() => setCreating(true)}>
          {strings.newPage}
        </Button>
      }
    >
      {failure !== undefined && <Callout tone="danger">{failure}</Callout>}
      <Table
        label={strings.title}
        columns={COLUMNS}
        rows={pages}
        getRowId={(page) => page.id}
        onRowAction={open}
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
        renderCell={(page, column) => {
          switch (column) {
            case 'title':
              return page.title;
            case 'status':
              return (
                <Badge
                  tone={page.status === 'live' ? 'accent' : 'neutral'}
                  text={page.status === 'live' ? strings.live : strings.paused}
                />
              );
            case 'bookings':
              return strings.bookingsCount(page.bookingsThisMonth);
            default:
              return (
                <>
                  <CopyButton
                    value={publicBookingUrl(page.publicKey)}
                    label={strings.copyLink}
                    isIconOnly
                    variant="ghost"
                  />
                  {page.canChange && (
                    <>
                      <Button
                        variant="ghost"
                        onPress={() => setStatus(page, page.status === 'live' ? 'paused' : 'live')}
                      >
                        {page.status === 'live' ? strings.pause : strings.resume}
                      </Button>
                      <Button
                        variant="ghost"
                        icon="trash"
                        label={`${strings.delete} ${page.title}`}
                        onPress={() => setDeleting(page)}
                      />
                    </>
                  )}
                </>
              );
          }
        }}
      />
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
    </SettingsPage>
  );
}

/** New booking page: a title, then the builder. The id is minted once per dialog, so a retry makes one page. */
function NewPageDialog({
  data,
  slug,
  isOpen,
  onClose,
  onCreated,
}: {
  readonly data: DataLayer;
  readonly slug: string;
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onCreated: (page: BookingPageView) => void;
}) {
  const [title, setTitle] = useState('');
  const [id, setId] = useState(() => data.bookingPages.newId());
  const [isBusy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const create = () => {
    if (isBusy) return;
    if (title.trim() === '') {
      setError(strings.titleRequired);
      return;
    }
    setBusy(true);
    setError(undefined);
    data.bookingPages.create(slug, { id, title: title.trim(), timeZone: browserZone() }).then(
      (page) => {
        setBusy(false);
        setTitle('');
        setId(data.bookingPages.newId());
        onCreated(page);
      },
      (failure: unknown) => {
        setBusy(false);
        setError(isDataError(failure) ? failure.message : strings.somethingWrong);
      },
    );
  };
  return (
    <Modal
      title={strings.newPageTitle}
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open && !isBusy) onClose();
      }}
      actions={
        <>
          <Button slot="close" isDisabled={isBusy} kbd="ESC">
            {strings.cancel}
          </Button>
          <Button variant="primary" isPending={isBusy} onPress={create}>
            {isBusy ? strings.creating : strings.create}
          </Button>
        </>
      }
    >
      <Field
        label={strings.newPageLabel}
        placeholder={strings.newPagePlaceholder}
        value={title}
        onChange={setTitle}
        onSubmit={create}
        maxLength={120}
        isRequired
        {...(error === undefined ? {} : { error })}
      />
    </Modal>
  );
}

/** Delete <title>?: its link stops working, its bookings stay (AC-648). */
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
      onOpenChange={(open) => {
        if (!open && !isBusy) onClose();
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

/** The list while its pages load: the frame, the header and skeleton rows. */
export function BookingPagesPending() {
  const { slug = '' } = useParams({ strict: false });
  return (
    <SettingsPage
      title={strings.title}
      crumbs={settingsCrumbs(slug, 'objects')}
      description={strings.description}
      current="booking-pages"
    >
      <Table label={strings.title} columns={COLUMNS} rows={[]} getRowId={() => ''} renderCell={() => null} isLoading />
    </SettingsPage>
  );
}
