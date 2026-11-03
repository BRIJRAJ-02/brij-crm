// Brief
// Purpose: a page that confirms each booking first (spec 0062, AC-6203): the requests waiting for its host's answer.
// Main task: Confirm one, or Decline it with an optional reason the visitor is sent; each holds its time until then.
// Leaves out: confirmed bookings (Bookings lists them) and changing a request's time (it moves once it is confirmed).
import { isDataError, type BookingRequestView, type DataLayer } from '@crm/data';
import { Button, Card, EmptyState, Field, Modal, Table, useFormatSettings, type TableColumn } from '@crm/ui';
import { useCallback, useEffect, useState } from 'react';
import { strings } from './strings.ts';

const COLUMNS: readonly TableColumn[] = [
  { id: 'who', label: strings.requests, isRowHeader: true },
  { id: 'when', label: strings.linkExpires },
  { id: 'actions', label: strings.confirm, isLabelHidden: true, align: 'end' },
];

/** Props for the card. */
export interface RequestsCardProps {
  readonly data: DataLayer;
  readonly slug: string;
  readonly pageId: string;
}

type Loaded =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly requests: readonly BookingRequestView[] };

/** The card: the page's requests, soonest first, each with Confirm and Decline. */
export function RequestsCard({ data, slug, pageId }: RequestsCardProps) {
  const { locale, timeZone } = useFormatSettings();
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' });
  const [busy, setBusy] = useState<string | undefined>(undefined);
  const [declining, setDeclining] = useState<BookingRequestView | undefined>(undefined);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const read = useCallback(() => {
    data.bookingFlow.requests(slug, pageId).then(
      (requests) => setLoaded({ status: 'ready', requests }),
      () => setLoaded({ status: 'error' }),
    );
  }, [data, slug, pageId]);
  useEffect(() => read(), [read]);
  const at = (iso: string) =>
    new Intl.DateTimeFormat(locale, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
      timeZone,
    }).format(new Date(iso));
  const confirm = (request: BookingRequestView) => {
    setBusy(request.bookingId);
    setFailure(undefined);
    data.bookingFlow.confirm(slug, request.bookingId).then(
      () => {
        setBusy(undefined);
        read();
      },
      (error: unknown) => {
        setBusy(undefined);
        setFailure(isDataError(error) ? error.message : strings.linkFailed);
      },
    );
  };
  return (
    <Card
      title={strings.requests}
      description={strings.requestsLine}
      {...(failure === undefined ? {} : { footerNote: failure })}
    >
      {loaded.status === 'loading' && <EmptyState layout="row" isLoading title={strings.requests} />}
      {loaded.status === 'error' && (
        <EmptyState layout="row" tone="error" title={strings.requestsFailed} onRetry={read} />
      )}
      {loaded.status === 'ready' &&
        (loaded.requests.length === 0 ? (
          <EmptyState layout="row" icon="inbox" title={strings.noRequests} />
        ) : (
          <Table
            label={strings.requests}
            columns={COLUMNS}
            rows={loaded.requests}
            isHeaderHidden
            getRowId={(request) => request.bookingId}
            renderCell={(request, column) =>
              column === 'who' ? (
                `${request.visitorName} · ${at(request.start)}`
              ) : column === 'when' ? (
                strings.answerBy(at(request.expiresAt))
              ) : (
                <>
                  <Button
                    isDisabled={busy !== undefined && busy !== request.bookingId}
                    onPress={() => setDeclining(request)}
                  >
                    {strings.decline}
                  </Button>
                  <Button
                    variant="primary"
                    isPending={busy === request.bookingId}
                    isDisabled={busy !== undefined && busy !== request.bookingId}
                    onPress={() => confirm(request)}
                  >
                    {strings.confirm}
                  </Button>
                </>
              )
            }
          />
        ))}
      <DeclineRequest
        request={declining}
        onClose={() => setDeclining(undefined)}
        onDecline={(request, reason) =>
          data.bookingFlow.decline(slug, request.bookingId, reason).then(
            () => {
              setDeclining(undefined);
              read();
            },
            (error: unknown) => {
              setDeclining(undefined);
              setFailure(isDataError(error) ? error.message : strings.linkFailed);
            },
          )
        }
      />
    </Card>
  );
}

/** "Decline this request?": a danger Modal with an optional reason, Cancel then Decline. */
function DeclineRequest({
  request,
  onClose,
  onDecline,
}: {
  readonly request: BookingRequestView | undefined;
  readonly onClose: () => void;
  readonly onDecline: (request: BookingRequestView, reason: string | undefined) => Promise<void>;
}) {
  const [isBusy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [last, setLast] = useState(request);
  if (request !== undefined && request !== last) {
    setLast(request);
    setReason('');
  }
  const shown = request ?? last;
  if (shown === undefined) return null;
  return (
    <Modal
      title={strings.declineTitle}
      tone="danger"
      isOpen={request !== undefined}
      isBusy={isBusy}
      onOpenChange={(open) => {
        if (!open && !isBusy) onClose();
      }}
      actions={
        <>
          <Button slot="close" kbd="ESC" isDisabled={isBusy}>
            {strings.cancel}
          </Button>
          <Button
            variant="danger-solid"
            isPending={isBusy}
            onPress={() => {
              if (isBusy) return;
              setBusy(true);
              const trimmed = reason.trim();
              void onDecline(shown, trimmed === '' ? undefined : trimmed).finally(() => setBusy(false));
            }}
          >
            {strings.decline}
          </Button>
        </>
      }
    >
      <Field
        label={strings.declineReason}
        hint={strings.declineReasonHint}
        maxLength={500}
        value={reason}
        onChange={setReason}
      />
    </Modal>
  );
}
