// Brief
// Purpose: Settings › Workspace › Webhooks (spec 0064, AC-6419 to AC-6425): where bookings and form submissions are sent.
// Main task: add an endpoint, copy its secret once, and see whether deliveries arrive (test, log, resend).
// Leaves out: custom headers, filters per event and per page, and webhooks for records and deals (later).
import {
  isDataError,
  type DataLayer,
  type WebhookDelivery,
  type WebhookEndpoint,
  type WebhookEventType,
  type WebhookList,
} from '@crm/data';
import {
  Button,
  Callout,
  ChoiceChips,
  Code,
  EmptyState,
  Field,
  Form,
  Modal,
  RelativeTime,
  SettingsRow,
  SettingsSection,
  Switch,
  Table,
  TruncatedText,
  focusLater,
  type Hue,
  type Toasts,
} from '@crm/ui';
// StatusDot shows an endpoint's and a delivery's state here, not an attribute value.
// eslint-disable-next-line no-restricted-imports -- an endpoint's state, not an attribute value
import { StatusDot } from '@crm/ui';
import { useEffect, useRef, useState } from 'react';
import { SettingsPage } from './SettingsPage.tsx';
import { strings } from './webhooks-strings.ts';

/** Every event an endpoint can get, in the order the chips show them. */
const EVENT_TYPES: readonly WebhookEventType[] = [
  'booking.created',
  'booking.rescheduled',
  'booking.cancelled',
  'booking.no_show',
  'form.submitted',
  'link_page.signup',
];

/** The chips' choices. */
const EVENT_CHOICES = EVENT_TYPES.map((type) => ({ id: type, label: strings.event(type) }));

/** The endpoints table's columns, loaded or loading. */
const ENDPOINT_COLUMNS = [
  { id: 'endpoint', label: strings.columnEndpoint, isRowHeader: true, size: 'fill' },
  { id: 'events', label: strings.columnEvents, size: 'fit' },
  { id: 'status', label: strings.columnStatus, size: 'fit' },
  { id: 'last', label: strings.columnLast, size: 'fit' },
] as const;

/** Add endpoint's form, which its footer's submit names. */
const ADD_FORM = 'webhook-add';

/** The most endpoints a workspace may have (AC-6419). */
const ENDPOINTS_MAX = 10;

/** A refusal's own words, or the plain fallback. */
const refusalOf = (failure: unknown): string =>
  isDataError(failure) && failure.code !== 'INTERNAL' ? failure.message : strings.saveFailed;

/** A refusal's words on one field, when it names that field. */
const fieldRefusal = (failure: unknown, field: string): string | undefined =>
  isDataError(failure) && failure.data?.refusals?.some((each) => each.field === field) === true
    ? failure.message
    : undefined;

/** An endpoint's status as its dot shows it. */
function statusOf(endpoint: WebhookEndpoint): { readonly hue: Hue; readonly label: string } {
  if (endpoint.status === 'active') return { hue: 'green', label: strings.active };
  return endpoint.offReason === 'failing'
    ? { hue: 'red', label: strings.failing }
    : { hue: 'gray', label: strings.off };
}

/** A delivery's state as its dot shows it. */
const deliveryHue = (delivery: Pick<WebhookDelivery, 'state'>): Hue =>
  delivery.state === 'sent' ? 'green' : delivery.state === 'pending' ? 'gray' : 'red';

/** Props for the Webhooks screen. */
export interface WebhooksScreenProps {
  readonly data: DataLayer;
  readonly toasts: Toasts;
  readonly slug: string;
  /** The endpoints as the route's loader read them; each write's answer is put in place. */
  readonly initial: WebhookList;
}

/** Settings › Webhooks: the endpoints as a table; one opens with its secret, switch, test and log. */
export function WebhooksScreen({ data, toasts, slug, initial }: WebhooksScreenProps) {
  const [endpoints, setEndpoints] = useState<readonly WebhookEndpoint[]>(initial.endpoints);
  const [isAdding, setIsAdding] = useState(false);
  const [addKey, setAddKey] = useState(0);
  const startAdding = () => {
    setAddKey((key) => key + 1);
    setIsAdding(true);
  };
  const [openId, setOpenId] = useState<string | undefined>(undefined);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const open = endpoints.find((endpoint) => endpoint.id === openId);
  const atLimit = endpoints.length >= ENDPOINTS_MAX;

  const put = (endpoint: WebhookEndpoint) =>
    setEndpoints((held) =>
      held.some((each) => each.id === endpoint.id)
        ? held.map((each) => (each.id === endpoint.id ? endpoint : each))
        : [endpoint, ...held],
    );

  if (!initial.available) {
    return (
      <SettingsPage title={strings.title} titleRef={titleRef}>
        <EmptyState icon="plug" title={strings.unavailableTitle}>
          {strings.unavailableText}
        </EmptyState>
      </SettingsPage>
    );
  }

  return (
    <SettingsPage title={strings.title} titleRef={titleRef}>
      <SettingsSection
        title={strings.endpoints}
        description={strings.description}
        actions={
          <Button variant="primary" icon="plus" isDisabled={atLimit} onPress={startAdding}>
            {strings.add}
          </Button>
        }
      >
        {atLimit && <Callout tone="info">{strings.atLimit}</Callout>}
        <Table
          label={strings.endpoints}
          columns={ENDPOINT_COLUMNS}
          rows={endpoints}
          getRowId={(endpoint) => endpoint.id}
          onRowAction={setOpenId}
          emptyState={
            <EmptyState
              icon="plug"
              title={strings.emptyTitle}
              actions={
                <Button variant="primary" icon="plus" onPress={startAdding}>
                  {strings.add}
                </Button>
              }
            >
              {strings.emptyText}
            </EmptyState>
          }
          renderCell={(endpoint, column) => {
            switch (column) {
              case 'endpoint':
                return (
                  <TruncatedText>
                    {endpoint.description === '' ? endpoint.url : `${endpoint.description} · ${endpoint.url}`}
                  </TruncatedText>
                );
              case 'events':
                return <TruncatedText>{endpoint.events.map((type) => strings.event(type)).join(', ')}</TruncatedText>;
              case 'status': {
                const status = statusOf(endpoint);
                return <StatusDot hue={status.hue}>{status.label}</StatusDot>;
              }
              default:
                return endpoint.lastDelivery === undefined ? (
                  strings.never
                ) : (
                  <>
                    <StatusDot hue={deliveryHue(endpoint.lastDelivery)}>
                      {strings.state(endpoint.lastDelivery.state)}
                    </StatusDot>{' '}
                    <RelativeTime value={endpoint.lastDelivery.at} />
                  </>
                );
            }
          }}
        />
      </SettingsSection>
      <AddEndpoint
        // A fresh form each time it opens.
        key={addKey}
        data={data}
        slug={slug}
        isOpen={isAdding}
        onClose={() => {
          setIsAdding(false);
          // The empty state's button that opened it may be gone now: focus the title rather than nowhere.
          focusLater(() => (document.activeElement === document.body ? titleRef.current : undefined));
        }}
        onAdded={(endpoint) => put(endpoint)}
      />
      {open !== undefined && (
        <EndpointDialog
          key={open.id}
          data={data}
          toasts={toasts}
          slug={slug}
          endpoint={open}
          onChange={put}
          onDeleted={(id) => {
            setOpenId(undefined);
            setEndpoints((held) => held.filter((each) => each.id !== id));
            toasts.toast({ tone: 'success', message: strings.deleted });
            // The row that opened it is gone: focus goes to the page's title rather than nowhere.
            focusLater(() => (document.activeElement === document.body ? titleRef.current : undefined));
          }}
          onClose={() => setOpenId(undefined)}
        />
      )}
    </SettingsPage>
  );
}

/** Add endpoint (AC-6419): the address, a description and the events; then its secret, shown once (AC-6420). */
function AddEndpoint({
  data,
  slug,
  isOpen,
  onClose,
  onAdded,
}: {
  readonly data: DataLayer;
  readonly slug: string;
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onAdded: (endpoint: WebhookEndpoint) => void;
}) {
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [events, setEvents] = useState<readonly string[]>(['booking.created']);
  const [isBusy, setIsBusy] = useState(false);
  const [urlError, setUrlError] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [secret, setSecret] = useState<string | undefined>(undefined);

  const add = async () => {
    setIsBusy(true);
    setUrlError(undefined);
    setError(undefined);
    try {
      const made = await data.webhooks.create(slug, {
        url: url.trim(),
        description: description.trim(),
        events: EVENT_TYPES.filter((type) => events.includes(type)),
      });
      onAdded(made.endpoint);
      setSecret(made.secret);
    } catch (failure) {
      const onUrl = fieldRefusal(failure, 'url');
      if (onUrl === undefined) setError(refusalOf(failure));
      else setUrlError(onUrl);
    } finally {
      setIsBusy(false);
    }
  };

  if (secret !== undefined) {
    return (
      <Modal
        key="secret"
        title={strings.secretTitle}
        icon="key"
        isDismissable={false}
        isClosable={false}
        isOpen={isOpen}
        onOpenChange={(next) => {
          if (!next) onClose();
        }}
        actions={
          <Button variant="primary" onPress={onClose}>
            {strings.done}
          </Button>
        }
      >
        {strings.secretText}
        <Code variant="block" isCopyable copyLabel={strings.copySecret}>
          {secret}
        </Code>
      </Modal>
    );
  }

  return (
    <Modal
      key="add"
      title={strings.addTitle}
      variant="form"
      isOpen={isOpen}
      isBusy={isBusy}
      isDismissable={url === '' && description === ''}
      onOpenChange={(next) => {
        if (!next && !isBusy) onClose();
      }}
      actions={
        <>
          <Button slot="close" isDisabled={isBusy}>
            {strings.cancel}
          </Button>
          <Button
            variant="primary"
            type="submit"
            form={ADD_FORM}
            isPending={isBusy}
            isDisabled={!url.trim().startsWith('https://') || events.length === 0}
          >
            {isBusy ? strings.adding : strings.add}
          </Button>
        </>
      }
    >
      {error !== undefined && (
        <Callout tone="danger" isAnnounced>
          {error}
        </Callout>
      )}
      <Form id={ADD_FORM} isBusy={isBusy} onSubmit={() => void add()} label={strings.addTitle} focusesFirstField>
        <Field
          label={strings.url}
          type="url"
          value={url}
          onChange={setUrl}
          placeholder={strings.urlPlaceholder}
          hint={strings.urlHint}
          {...(urlError === undefined ? {} : { error: urlError })}
        />
        <Field
          label={strings.descriptionLabel}
          value={description}
          onChange={setDescription}
          placeholder={strings.descriptionPlaceholder}
          maxLength={120}
        />
        <ChoiceChips label={strings.events} choices={EVENT_CHOICES} selected={events} onChange={setEvents} />
      </Form>
    </Modal>
  );
}

/** One endpoint (AC-6420, AC-6425): its switch, events, secret, test event and delivery log, and its delete. */
function EndpointDialog({
  data,
  toasts,
  slug,
  endpoint,
  onChange,
  onDeleted,
  onClose,
}: {
  readonly data: DataLayer;
  readonly toasts: Toasts;
  readonly slug: string;
  readonly endpoint: WebhookEndpoint;
  readonly onChange: (endpoint: WebhookEndpoint) => void;
  readonly onDeleted: (id: string) => void;
  readonly onClose: () => void;
}) {
  const [events, setEvents] = useState<readonly string[]>(endpoint.events);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [confirm, setConfirmState] = useState<'rotate' | 'delete' | undefined>(undefined);
  const [confirmError, setConfirmError] = useState<string | undefined>(undefined);
  const [toggling, setToggling] = useState(false);
  const setConfirm = (next: 'rotate' | 'delete' | undefined) => {
    setConfirmError(undefined);
    setConfirmState(next);
  };
  const [isBusy, setIsBusy] = useState(false);
  const [secret, setSecret] = useState<string | undefined>(undefined);
  const [testing, setTesting] = useState(false);
  const [tested, setTested] = useState<WebhookDelivery | undefined>(undefined);
  const [log, setLog] = useState<readonly WebhookDelivery[] | undefined>(undefined);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [logFailed, setLogFailed] = useState(false);
  const [resending, setResending] = useState<string | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);

  const readLog = async (after?: string) => {
    setLogFailed(false);
    try {
      const page = await data.webhooks.deliveries(slug, endpoint.id, after);
      setLog((held) => (after === undefined ? page.deliveries : [...(held ?? []), ...page.deliveries]));
      setCursor(page.nextCursor);
    } catch {
      setLogFailed(true);
    }
  };

  // The first page, read once for the endpoint the dialog opened on (the dialog is keyed by it).
  useEffect(() => {
    let isCurrent = true;
    data.webhooks.deliveries(slug, endpoint.id).then(
      (page) => {
        if (!isCurrent) return;
        setLog(page.deliveries);
        setCursor(page.nextCursor);
      },
      () => {
        if (isCurrent) setLogFailed(true);
      },
    );
    return () => {
      isCurrent = false;
    };
  }, [data, slug, endpoint.id]);

  /** Puts a delivery the screen just sent at the top of the log, or in place of its old row. */
  const putDelivery = (delivery: WebhookDelivery) =>
    setLog((held) => [delivery, ...(held ?? []).filter((each) => each.id !== delivery.id)]);

  // The switch shows at once and is put back if refused (crm-frontend-state).
  const setOn = async (on: boolean) => {
    const was = endpoint;
    setToggling(true);
    onChange({ ...endpoint, status: on ? 'active' : 'off' });
    setError(undefined);
    try {
      onChange(await data.webhooks.update(slug, endpoint.id, { status: on ? 'active' : 'off' }));
    } catch (failure) {
      onChange(was);
      setError(refusalOf(failure));
    } finally {
      setToggling(false);
    }
  };

  // Each chip saves as it is pressed, as the switch does: shown at once, put back if refused (one save model).
  const saveEvents = async (next: readonly string[]) => {
    if (next.length === 0) return;
    const was = events;
    setEvents(next);
    setSaving(true);
    setError(undefined);
    try {
      onChange(
        await data.webhooks.update(slug, endpoint.id, { events: EVENT_TYPES.filter((type) => next.includes(type)) }),
      );
    } catch (failure) {
      setEvents(was);
      setError(refusalOf(failure));
    } finally {
      setSaving(false);
    }
  };

  const rotate = async () => {
    setIsBusy(true);
    try {
      const rotated = await data.webhooks.rotateSecret(slug, endpoint.id);
      onChange(rotated.endpoint);
      setSecret(rotated.secret);
      setConfirm(undefined);
    } catch (failure) {
      setConfirmError(refusalOf(failure));
    } finally {
      setIsBusy(false);
    }
  };

  const remove = async () => {
    setIsBusy(true);
    try {
      await data.webhooks.remove(slug, endpoint.id);
      onDeleted(endpoint.id);
    } catch (failure) {
      setConfirmError(refusalOf(failure));
    } finally {
      setIsBusy(false);
    }
  };

  const test = async () => {
    setTesting(true);
    setTested(undefined);
    setError(undefined);
    try {
      const delivery = await data.webhooks.test(slug, endpoint.id);
      setTested(delivery);
      putDelivery(delivery);
    } catch (failure) {
      setError(refusalOf(failure));
    } finally {
      setTesting(false);
    }
  };

  const resend = async (deliveryId: string) => {
    setResending(deliveryId);
    setError(undefined);
    try {
      const delivery = await data.webhooks.resend(slug, deliveryId);
      putDelivery(delivery);
      toasts.toast({
        tone: delivery.state === 'sent' ? 'success' : 'danger',
        message: delivery.state === 'sent' ? strings.resent : strings.resendFailed,
      });
    } catch (failure) {
      toasts.toast({ tone: 'danger', message: refusalOf(failure) });
    } finally {
      setResending(undefined);
    }
  };

  if (secret !== undefined) {
    return (
      <Modal
        key="secret"
        title={strings.secretTitle}
        icon="key"
        isDismissable={false}
        isClosable={false}
        isOpen
        onOpenChange={(next) => {
          if (!next) setSecret(undefined);
        }}
        actions={
          <Button variant="primary" onPress={() => setSecret(undefined)}>
            {strings.done}
          </Button>
        }
      >
        {strings.secretText}
        <Code variant="block" isCopyable copyLabel={strings.copySecret}>
          {secret}
        </Code>
      </Modal>
    );
  }

  if (confirm !== undefined) {
    const isDelete = confirm === 'delete';
    return (
      <Modal
        key="confirm"
        title={isDelete ? strings.deleteTitle : strings.rotateTitle}
        variant="confirm"
        {...(isDelete ? { tone: 'danger' as const } : {})}
        isOpen
        isBusy={isBusy}
        onOpenChange={(next) => {
          if (!next && !isBusy) setConfirm(undefined);
        }}
        actions={
          <>
            <Button slot="close" isDisabled={isBusy}>
              {strings.cancel}
            </Button>
            <Button
              variant={isDelete ? 'danger-solid' : 'primary'}
              {...(isDelete ? { icon: 'trash' as const } : {})}
              isPending={isBusy}
              onPress={() => void (isDelete ? remove() : rotate())}
            >
              {isDelete
                ? isBusy
                  ? strings.deleting
                  : strings.deleteAction
                : isBusy
                  ? strings.rotating
                  : strings.rotateAction}
            </Button>
          </>
        }
      >
        {confirmError !== undefined && (
          <Callout tone="danger" isAnnounced>
            {confirmError}
          </Callout>
        )}
        {isDelete ? strings.deleteText : strings.rotateText}
      </Modal>
    );
  }

  const status = statusOf(endpoint);
  return (
    <Modal
      key="window"
      title={endpoint.description === '' ? strings.endpointTitle : endpoint.description}
      icon="plug"
      variant="window"
      isOpen
      context={endpoint.url}
      status={<StatusDot hue={status.hue}>{status.label}</StatusDot>}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      footerStart={
        <Button variant="ghost-danger" icon="trash" onPress={() => setConfirm('delete')}>
          {strings.delete}
        </Button>
      }
      actions={<Button slot="close">{strings.close}</Button>}
    >
      {error !== undefined && (
        <Callout tone="danger" isAnnounced>
          {error}
        </Callout>
      )}
      {endpoint.status === 'off' && endpoint.offReason === 'failing' && (
        <Callout tone="danger">{strings.failingHelp}</Callout>
      )}
      <SettingsRow title={strings.on}>
        <Switch
          label={strings.on}
          isLabelHidden
          isSelected={endpoint.status === 'active'}
          isDisabled={toggling}
          onChange={(on) => void setOn(on)}
        />
      </SettingsRow>
      <SettingsRow
        title={strings.secret}
        description={
          endpoint.previousSecretUntil === undefined ? (
            strings.secretHint(endpoint.secretHint)
          ) : (
            <>
              {strings.secretHint(endpoint.secretHint)}. {strings.overlap}{' '}
              <RelativeTime value={endpoint.previousSecretUntil} />
            </>
          )
        }
      >
        <Button icon="refresh-cw" onPress={() => setConfirm('rotate')}>
          {strings.rotate}
        </Button>
      </SettingsRow>
      <SettingsRow title={strings.test}>
        <Button icon="send" isPending={testing} onPress={() => void test()}>
          {testing ? strings.testing : strings.test}
        </Button>
      </SettingsRow>
      {tested !== undefined && (
        <Callout tone={tested.state === 'sent' ? 'success' : 'danger'} isAnnounced>
          {tested.state === 'sent' || tested.failure === undefined
            ? strings.testResult(tested)
            : `${strings.testResult(tested)}. ${strings.failure[tested.failure]}`}
        </Callout>
      )}
      <ChoiceChips
        label={strings.events}
        choices={EVENT_CHOICES}
        selected={events}
        isDisabled={saving}
        onChange={(next) => void saveEvents(next)}
      />
      <SettingsSection title={strings.log}>
        {logFailed ? (
          <EmptyState tone="error" title={strings.logFailedTitle} onRetry={() => void readLog()}>
            {strings.failedText}
          </EmptyState>
        ) : (
          <Table
            label={strings.log}
            isScrollable
            isLoading={log === undefined}
            columns={[
              { id: 'event', label: strings.columnEvent, isRowHeader: true, size: 'fit' },
              { id: 'state', label: strings.columnStatus, size: 'fit' },
              { id: 'answer', label: strings.columnAnswer, size: 'fill' },
              { id: 'code', label: strings.columnStatusCode, size: 'fit', align: 'end' },
              { id: 'time', label: strings.columnTime, size: 'fit', align: 'end' },
              { id: 'attempt', label: strings.columnAttempt, size: 'fit', align: 'end' },
              { id: 'when', label: strings.columnWhen, size: 'fit' },
              { id: 'resend', label: strings.resend, size: 'fit', isLabelHidden: true },
            ]}
            rows={log ?? []}
            getRowId={(delivery) => delivery.id}
            emptyState={
              <EmptyState icon="inbox" title={strings.logEmpty} layout="row">
                {strings.logEmptyText}
              </EmptyState>
            }
            renderCell={(delivery, column) => {
              switch (column) {
                case 'event':
                  return strings.event(delivery.eventType);
                case 'answer':
                  return delivery.responseExcerpt === undefined ? (
                    delivery.failure === undefined ? (
                      ''
                    ) : (
                      strings.failure[delivery.failure]
                    )
                  ) : (
                    <TruncatedText>{delivery.responseExcerpt}</TruncatedText>
                  );
                case 'state':
                  return <StatusDot hue={deliveryHue(delivery)}>{strings.state(delivery.state)}</StatusDot>;
                case 'code':
                  return delivery.responseStatus === undefined ? '' : String(delivery.responseStatus);
                case 'time':
                  return delivery.responseMs === undefined ? '' : strings.ms(delivery.responseMs);
                case 'attempt':
                  return String(delivery.attempt);
                case 'when':
                  return <RelativeTime value={delivery.sentAt ?? delivery.createdAt} />;
                default:
                  return delivery.eventType === 'ping' ? null : (
                    <Button
                      variant="ghost"
                      isPending={resending === delivery.id}
                      onPress={() => void resend(delivery.id)}
                    >
                      {strings.resend}
                    </Button>
                  );
              }
            }}
          />
        )}
        {cursor !== undefined && (
          <Button
            variant="ghost"
            isPending={loadingMore}
            onPress={() => {
              setLoadingMore(true);
              void readLog(cursor).finally(() => setLoadingMore(false));
            }}
          >
            {strings.more}
          </Button>
        )}
      </SettingsSection>
    </Modal>
  );
}

/** Settings › Webhooks while it loads: the section and its table, its rows as skeletons. */
export function WebhooksPending() {
  return (
    <SettingsPage title={strings.title} isLoading>
      <SettingsSection
        title={strings.endpoints}
        description={strings.description}
        actions={
          <Button variant="primary" icon="plus" isDisabled>
            {strings.add}
          </Button>
        }
      >
        <Table
          label={strings.endpoints}
          isLoading
          columns={ENDPOINT_COLUMNS}
          rows={[]}
          getRowId={() => ''}
          renderCell={() => null}
        />
      </SettingsSection>
    </SettingsPage>
  );
}
