// Brief
// Purpose: Bookings settings › Calendars, the one home for the member's calendar accounts (Google, Outlook), answering
// three questions in plain words: which accounts are connected, which calendars block your times, where new bookings go.
// Main task: connect an account through the one Connect a calendar popup; then per calendar, check it for conflicts,
// show it on the week, log its meetings to the CRM and pick its colour; disconnect an account (it asks first).
// Leaves out: other members' calendars, calendars not in use, and Apple (parked). Owners and admins also choose
// whether meetings add people.
import {
  isDataError,
  needsReconnect,
  type CalendarAccountView,
  type CalendarChange,
  type CalendarConnectionView,
  type CalendarItem,
  type CalendarListState,
  type CalendarProvider,
  type CalendarStatus,
  type CalendarView,
  type DataLayer,
  type Hue,
} from '@crm/data';
import { useCalendar, useCalendarList, useCalendarSettings } from '@crm/data/react';
import {
  Badge,
  Button,
  Callout,
  Card,
  EmptyState,
  focusLater,
  HuePicker,
  InfoTip,
  Menu,
  MenuItem,
  MenuSection,
  MenuSeparator,
  MenuTrigger,
  Modal,
  ProviderMark,
  RelativeTime,
  Select,
  SettingsRow,
  SettingsRowGroup,
  SettingsSection,
  Skeleton,
  Switch,
  type Toasts,
} from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { calendarOptions } from '../calendars/calendar-options.ts';
import { noteConnectStart, sessionNotes, type ConnectArrival } from '../calendars/connect-start.ts';
import { isCalendarInUse } from '../calendars/in-use.ts';
import { strings } from './calendar-strings.ts';
import { ConnectCalendarDialog, PROVIDER, type ConnectStep } from './ConnectCalendarDialog.tsx';
import type { ConnectResult } from './connect-result.ts';
import { SettingsPage } from './SettingsPage.tsx';

/**
 * The page while the accounts load. No calendar yet is the page most people first load, an empty state with no
 * card, so the loading state stands in its place (the loading shape flow holds them together).
 */
export function CalendarsLoading() {
  return <EmptyState layout="block" icon="calendar" title={strings.loading} isLoading />;
}

/** Props for the Calendar screen: what its route loaded through the data layer. */
export interface CalendarScreenProps {
  readonly data: DataLayer;
  readonly slug: string;
  readonly view: CalendarView;
  /** What the browser came back from the provider with, once (`?calendar=`). */
  readonly result?: ConnectResult;
  /** Which account a connect that came back `connected` made, as the route read it (`takeConnectArrival`). */
  readonly arrival?: ConnectArrival;
  /** Clears `?calendar=` once the page has read it. */
  readonly onResultSeen: () => void;
}

const number = new Intl.NumberFormat();

/** Each state's dot: green when it is up to date, blue while it connects, red once it needs reconnecting. */
const STATUS_HUE = {
  syncing: 'blue',
  connected: 'green',
  expired: 'red',
  revoked: 'red',
  failed: 'red',
} as const satisfies Record<CalendarStatus, Hue>;

/** A calendar's switches: Check for conflicts on its row, Show on my week and Log meetings to CRM in its menu. */
type SwitchName = 'checkConflicts' | 'showInWeek' | 'sync';

/** What a calendar's row can change, each saved at once (the owner's save rule, 21 October 2026). */
interface CalendarActions {
  readonly onSwitch: (calendar: CalendarItem, name: SwitchName, isOn: boolean) => void;
  readonly onColour: (calendar: CalendarItem, hue: Hue) => void;
  readonly onMakeDefault: (calendar: CalendarItem) => void;
}

/** A calendar's row: its colour, name and Logs to CRM badge, the conflicts switch, and a menu of the other two. */
function CalendarRow({
  calendar,
  isStopped,
  actions,
}: {
  readonly calendar: CalendarItem;
  /** Its account needs reconnecting: nothing on it is read until then. */
  readonly isStopped: boolean;
  readonly actions: CalendarActions;
}) {
  const menuLabel = strings.calendarOptions(calendar.name);
  const selected = [...(calendar.showInWeek ? ['week'] : []), ...(calendar.sync ? ['log'] : [])];
  const description = isStopped ? strings.reconnectToCheck : calendar.warning?.message;
  return (
    <SettingsRow
      title={calendar.name}
      leadingAlign="center"
      leading={
        <HuePicker
          label={strings.colour(calendar.name)}
          value={calendar.hue}
          isCompact
          look="dot"
          onChange={(hue) => actions.onColour(calendar, hue)}
        />
      }
      {...(calendar.sync ? { meta: <Badge text={strings.logsBadge} isWhole /> } : {})}
      {...(description === undefined ? {} : { description })}
    >
      <Switch
        label={strings.checkFor(calendar.name)}
        isLabelHidden
        isSelected={calendar.checkConflicts}
        onChange={(isOn) => actions.onSwitch(calendar, 'checkConflicts', isOn)}
      />
      <MenuTrigger>
        <Button variant="ghost" icon="ellipsis" label={menuLabel} />
        <Menu
          label={menuLabel}
          selectionMode="multiple"
          selectedKeys={selected}
          onSelectionChange={(keys) => {
            if (keys.has('week') !== calendar.showInWeek) actions.onSwitch(calendar, 'showInWeek', keys.has('week'));
            if (keys.has('log') !== calendar.sync) actions.onSwitch(calendar, 'sync', keys.has('log'));
          }}
        >
          <MenuItem id="week" description={strings.showOnWeekHelp}>
            {strings.showOnWeek}
          </MenuItem>
          <MenuItem id="log" description={strings.logMeetingsHelp}>
            {strings.logMeetings}
          </MenuItem>
        </Menu>
      </MenuTrigger>
    </SettingsRow>
  );
}

/**
 * An account's calendars in use (the owner, 22 and 23 October 2026: the rest "don't show this anywhere"): its main
 * calendar, any switched on, and where bookings go. Which ones show is read once, so switching one off never moves it
 * out from under the pointer; it goes on the next visit, and its toast says so.
 */
function AccountCalendars({
  connection,
  calendars,
  actions,
  onRetry,
}: {
  readonly connection: CalendarConnectionView;
  /** Its calendars once listed; `loading` or `error` while the list isn't there. */
  readonly calendars: readonly CalendarItem[] | 'loading' | 'error';
  readonly actions: CalendarActions;
  readonly onRetry: () => void;
}) {
  const [shownIds] = useState(
    () =>
      new Set(typeof calendars === 'string' ? [] : calendars.filter(isCalendarInUse).map((calendar) => calendar.id)),
  );
  let body;
  if (calendars === 'loading') {
    body = (
      <span role="status" aria-label={strings.calendarsLoading}>
        <Skeleton width="long" />
      </span>
    );
  } else if (calendars === 'error') {
    body = (
      <Callout
        tone="danger"
        actions={
          <Button variant="ghost" onPress={onRetry}>
            {strings.tryAgain}
          </Button>
        }
      >
        {strings.calendarsFailed}
      </Callout>
    );
  } else {
    // One switched on since (in another tab, or in the connect popup) shows too.
    const shown = calendars.filter((calendar) => shownIds.has(calendar.id) || isCalendarInUse(calendar));
    const isStopped = needsReconnect(connection);
    body =
      calendars.length === 0 ? (
        <EmptyState layout="row" title={strings.noCalendars} />
      ) : shown.length === 0 ? (
        <EmptyState layout="row" title={strings.noneInUse} />
      ) : (
        shown.map((calendar) => (
          <CalendarRow key={calendar.id} calendar={calendar} isStopped={isStopped} actions={actions} />
        ))
      );
  }
  return <SettingsRowGroup title={connection.accountEmail}>{body}</SettingsRowGroup>;
}

/**
 * An account's row: the provider's mark, the address, its state in plain words (Connected · Updated 2 min ago, or
 * Needs reconnecting · why), Reconnect on the row once it stopped, and a "···" menu: Reconnect, Refresh now, what
 * teammates see, and Disconnect, which asks first.
 */
function AccountRow({
  connection,
  isNew,
  onSharing,
  onDisconnect,
  onReconnect,
  onRefresh,
}: {
  readonly connection: CalendarConnectionView;
  /** It just arrived from the provider: it washes in once. */
  readonly isNew: boolean;
  readonly onSharing: (sharing: 'shared' | 'private') => void;
  readonly onDisconnect: () => void;
  /** Connects the account again; absent when its provider isn't offered here. */
  readonly onReconnect?: () => void;
  readonly onRefresh: () => void;
}) {
  const menuLabel = strings.rowActions(connection.accountEmail);
  const isStopped = needsReconnect(connection);
  const why = connection.lastError?.message ?? strings.why[connection.status];
  return (
    <SettingsRow
      isNew={isNew}
      title={connection.accountEmail}
      leading={<ProviderMark provider={PROVIDER[connection.provider].mark} isLabelled />}
      description={
        <>
          <Badge text={strings.status[connection.status]} dot={STATUS_HUE[connection.status]} />
          {' · '}
          {isStopped ? (
            why
          ) : connection.lastSyncedAt === undefined ? (
            strings.notUpdatedYet
          ) : (
            <>
              {/* A no break space: "Updated" never ends a line on its own. */}
              {strings.updated} <RelativeTime value={connection.lastSyncedAt} />
            </>
          )}
        </>
      }
    >
      {/* An account that stopped shows its fix on the row, not behind the menu. */}
      {isStopped && onReconnect !== undefined && <Button onPress={onReconnect}>{strings.reconnect}</Button>}
      <MenuTrigger>
        <Button variant="ghost" icon="ellipsis" label={menuLabel} />
        <Menu
          label={menuLabel}
          onAction={(key) => {
            if (key === 'reconnect') onReconnect?.();
            if (key === 'refresh') onRefresh();
            if (key === 'disconnect') onDisconnect();
          }}
        >
          {onReconnect !== undefined && (
            <MenuItem id="reconnect" icon="link">
              {strings.reconnect}
            </MenuItem>
          )}
          <MenuItem id="refresh" icon="refresh-cw" description={strings.refreshHelp} isDisabled={isStopped}>
            {strings.refresh}
          </MenuItem>
          <MenuSection
            label={strings.sharingLabel}
            selectionMode="single"
            selectedKeys={[connection.sharing]}
            onSelectionChange={(keys) => {
              const picked = keys.has('private') ? 'private' : keys.has('shared') ? 'shared' : undefined;
              if (picked !== undefined && picked !== connection.sharing) onSharing(picked);
            }}
          >
            <MenuItem id="shared" description={strings.sharingHelp.shared}>
              {strings.shared}
            </MenuItem>
            <MenuItem id="private" description={strings.sharingHelp.private}>
              {strings.private}
            </MenuItem>
          </MenuSection>
          <MenuSeparator />
          <MenuItem id="disconnect" icon="unplug" isDanger>
            {strings.disconnect}
          </MenuItem>
        </Menu>
      </MenuTrigger>
    </SettingsRow>
  );
}

/**
 * Each calendar change, saved at once and said in a quiet toast with Undo (the owner's save rule, 21 October 2026).
 * A refusal is put back and said by the data layer; Undo is the same change the other way.
 */
function useCalendarActions(data: DataLayer, slug: string, toasts: Toasts, destination: CalendarItem | undefined) {
  // One toast at a time: switching eight calendars leaves the last change's Undo, not a stack of eight.
  const last = useRef<string | undefined>(undefined);
  return useMemo<CalendarActions>(() => {
    const say = (content: Parameters<Toasts['toast']>[0]) => {
      if (last.current !== undefined) toasts.dismiss(last.current);
      last.current = toasts.toast(content);
    };
    const change = (calendar: CalendarItem, next: CalendarChange, back: CalendarChange, message: string) => {
      void data.calendar.updateCalendar(slug, calendar.id, next).then((isDone) => {
        if (!isDone) return;
        say({
          tone: 'success',
          message,
          action: { label: strings.undo, onAction: () => void data.calendar.updateCalendar(slug, calendar.id, back) },
        });
      });
    };
    return {
      onSwitch: (calendar, name, isOn) => {
        const saved = strings.saved[name](calendar.name, isOn);
        // Its last use switched off: it keeps its row for now, and the toast says it won't be listed next time.
        const isLeaving = !isCalendarInUse({ ...calendar, [name]: isOn });
        change(calendar, { [name]: isOn }, { [name]: !isOn }, isLeaving ? strings.noLongerListed(saved) : saved);
      },
      onColour: (calendar, hue) =>
        change(
          calendar,
          { colourOverride: hue },
          { colourOverride: calendar.colourOverride ?? null },
          strings.colourSaved,
        ),
      onMakeDefault: (calendar) => {
        const was = destination;
        const saved = strings.defaultSaved(calendar.name);
        // Taking bookings was the old default's only use: it won't be listed next time.
        const leaving = was !== undefined && !isCalendarInUse({ ...was, isDestination: false }) ? was : undefined;
        void data.calendar.setDestination(slug, calendar.id).then((isDone) => {
          if (!isDone) return;
          say({
            tone: 'success',
            message: leaving === undefined ? saved : strings.noLongerListed(saved),
            ...(was === undefined
              ? {}
              : { action: { label: strings.undo, onAction: () => void data.calendar.setDestination(slug, was.id) } }),
          });
        });
      },
    };
  }, [data, slug, toasts, destination]);
}

/** Each account's calendars as the list holds them, by connection. */
function calendarsByAccount(list: CalendarListState): ReadonlyMap<string, readonly CalendarItem[]> {
  if (list.status !== 'ready') return new Map();
  return new Map(list.accounts.map((account: CalendarAccountView) => [account.id, account.calendars]));
}

/**
 * Bookings settings › Calendars (specs 0024 and 0026; the owner's calendar connect mock, 9 November 2026): Your
 * accounts, Check for conflicts, Add new bookings to, then the workspace's own switch for owners and admins. One
 * Connect calendar button opens the one popup.
 */
export function CalendarScreen({ data, slug, view, result, arrival, onResultSeen }: CalendarScreenProps) {
  const state = useCalendar(view);
  const list = useCalendarList(data.calendar.calendars(slug));
  const settings = useCalendarSettings(data.calendar.settings(slug));
  const { toasts } = useRouteContext({ from: '__root__' });
  const byAccount = calendarsByAccount(list);
  const allCalendars = [...byAccount.values()].flat();
  const destination = allCalendars.find((calendar) => calendar.isDestination);
  const writableOptions =
    list.status === 'ready'
      ? calendarOptions({ accounts: list.accounts, include: (calendar) => calendar.canBeDestination })
      : [];
  const actions = useCalendarActions(data, slug, toasts, destination);
  const [disconnecting, setDisconnecting] = useState<CalendarConnectionView | undefined>(undefined);
  const [isDisconnectBusy, setDisconnectBusy] = useState(false);
  // The last account the confirm was opened for: it stays named through the confirm's exit.
  const [lastDisconnecting, setLastDisconnecting] = useState<CalendarConnectionView | undefined>(undefined);
  if (disconnecting !== undefined && disconnecting !== lastDisconnecting) setLastDisconnecting(disconnecting);
  // Connect calendar (in the section's head, or the empty state's): where focus goes once an account is disconnected.
  const connectRef = useRef<HTMLButtonElement>(null);
  const [disconnectFailure, setDisconnectFailure] = useState<string | undefined>(undefined);
  // The connect popup's step: back from the provider, a problem opens it at what happened, and a new account at its
  // calendars.
  const [step, setStep] = useState<ConnectStep | undefined>(() =>
    result !== undefined && result !== 'connected'
      ? { kind: 'problem', result }
      : arrival?.kind === 'new'
        ? { kind: 'choose', connectionId: arrival.connectionId }
        : undefined,
  );
  // The account that just arrived from the provider: its row washes in once.
  const [arrivedId] = useState(() =>
    arrival === undefined || arrival.kind === 'unknown' ? undefined : arrival.connectionId,
  );

  const connections = useMemo(() => (state.status === 'ready' ? state.connections : []), [state]);
  const providers = state.status === 'ready' && state.enabled ? state.providers : [];
  const isFull = state.status === 'ready' && state.connections.length >= state.max;
  const canConnect = providers.length > 0 && !isFull;

  // `?calendar=` is read once, then cleared from the address. A reconnect, or a connect whose new account isn't known
  // (another tab started it), is said in a toast; a new account says so when its popup closes.
  const resultRead = useRef(false);
  useEffect(() => {
    if (result === undefined || resultRead.current) return;
    resultRead.current = true;
    if (result === 'connected' && arrival?.kind !== 'new') {
      toasts.toast({
        tone: 'success',
        message: arrival?.kind === 'reconnected' ? strings.reconnected : strings.connected,
      });
    }
    onResultSeen();
  }, [result, arrival, toasts, onResultSeen]);

  // Connecting is the browser going to the API, which sends it on to the provider's consent screen and back here.
  const goConnect = (provider: CalendarProvider, reconnecting?: string) => {
    noteConnectStart(sessionNotes(), {
      before: connections.map((connection) => connection.id),
      ...(reconnecting === undefined ? {} : { reconnecting }),
    });
    window.location.assign(data.calendar.connectUrl(slug, 'settings', provider));
  };

  const disconnect = () => {
    if (disconnecting === undefined || isDisconnectBusy) return;
    setDisconnectBusy(true);
    setDisconnectFailure(undefined);
    data.calendar.remove(slug, disconnecting.id, { asksFirst: true }).then(
      (isDone) => {
        setDisconnectBusy(false);
        // Refused (the connection came back): the confirm stays open and says so.
        if (!isDone) {
          setDisconnectFailure(strings.disconnectFailed);
          return;
        }
        toasts.toast({ tone: 'success', message: strings.disconnected(disconnecting.accountEmail) });
        setDisconnecting(undefined);
        // Its row went with it, and the menu that opened the confirm: focus goes to Connect calendar.
        focusLater(() => connectRef.current);
      },
      (error: unknown) => {
        // The confirm stays open with what went wrong, so the person can try again or cancel.
        setDisconnectBusy(false);
        setDisconnectFailure(isDataError(error) ? error.message : strings.disconnectFailed);
      },
    );
  };

  const openConnect = () => setStep({ kind: 'pick' });
  const connectButton = (variant: 'secondary' | 'primary') => (
    <Button ref={connectRef} variant={variant} icon="plus" isDisabled={!canConnect} onPress={openConnect}>
      {strings.connect}
    </Button>
  );
  const fellBack = list.status === 'ready' ? list.fellBack : undefined;
  const calendarsOf = (connectionId: string): readonly CalendarItem[] | 'loading' | 'error' =>
    list.status === 'ready' ? (byAccount.get(connectionId) ?? []) : list.status;
  const retryCalendars = () => data.calendar.calendars(slug).reload();

  let body;
  if (state.status === 'loading') {
    body = <CalendarsLoading />;
  } else if (state.status === 'error') {
    body = (
      <EmptyState tone="error" title={strings.failedTitle} onRetry={() => view.reload()}>
        {state.message}
      </EmptyState>
    );
  } else if (!state.enabled && state.connections.length === 0) {
    body = (
      <EmptyState layout="block" icon="calendar" title={strings.offTitle}>
        {strings.offText}
      </EmptyState>
    );
  } else if (state.connections.length === 0) {
    body = (
      <EmptyState
        layout="block"
        icon="calendar"
        title={strings.emptyTitle}
        {...(canConnect ? { actions: connectButton('primary') } : {})}
      >
        {strings.emptyText}
      </EmptyState>
    );
  } else {
    const count = number.format(state.connections.length);
    const max = number.format(state.max);
    body = (
      <>
        <SettingsSection
          title={strings.accountsSection}
          description={isFull ? strings.accountsFull(max) : strings.accountsCount(count, max)}
          {...(providers.length > 0 ? { actions: connectButton('secondary') } : {})}
        >
          <Card>
            {state.connections.map((connection) => (
              <AccountRow
                key={connection.id}
                connection={connection}
                isNew={connection.id === arrivedId}
                onSharing={(sharing) => {
                  const was = connection.sharing;
                  void data.calendar.setSharing(slug, connection.id, sharing).then((isDone) => {
                    if (!isDone) return;
                    toasts.toast({
                      tone: 'success',
                      message: strings.sharingSaved(sharing),
                      action: {
                        label: strings.undo,
                        onAction: () => void data.calendar.setSharing(slug, connection.id, was),
                      },
                    });
                  });
                }}
                // Reconnecting goes through the same consent and lands on the same account, so the limit doesn't stop it.
                {...(providers.includes(connection.provider)
                  ? { onReconnect: () => goConnect(connection.provider, connection.id) }
                  : {})}
                onRefresh={() => {
                  void data.calendar.syncNow(slug, connection.id).then((isQueued) => {
                    if (isQueued)
                      toasts.toast({ tone: 'success', message: strings.refreshing(connection.accountEmail) });
                  });
                }}
                onDisconnect={() => {
                  setDisconnectFailure(undefined);
                  setDisconnecting(connection);
                }}
              />
            ))}
          </Card>
        </SettingsSection>
        <SettingsSection title={strings.conflictsSection} description={strings.conflictsText}>
          <Card>
            {state.connections.map((connection) => (
              <AccountCalendars
                // Read again once its calendars arrive, so which ones show is read from the list, not from nothing.
                key={`${connection.id}:${list.status}`}
                connection={connection}
                calendars={calendarsOf(connection.id)}
                actions={actions}
                onRetry={retryCalendars}
              />
            ))}
          </Card>
        </SettingsSection>
        <SettingsSection title={strings.addBookingsTo}>
          {fellBack !== undefined && (
            <Callout
              tone="warning"
              title={strings.fellBackTitle}
              actions={
                <Button variant="ghost" onPress={() => void data.calendar.dismissCalendarNotice(slug)}>
                  {strings.dismiss}
                </Button>
              }
            >
              {destination === undefined
                ? strings.fellBackNone(fellBack.removedName)
                : strings.fellBackText(destination.name, fellBack.removedName)}
            </Callout>
          )}
          <Card>
            <SettingsRow
              title={strings.bookingsCalendar}
              control="field"
              description={
                list.status === 'ready' && writableOptions.length === 0
                  ? strings.noWritable
                  : strings.bookingsCalendarText
              }
            >
              <Select
                savesOnPick
                label={strings.addBookingsTo}
                isLabelHidden
                optionStyle="dot"
                items={writableOptions}
                value={destination?.id ?? null}
                placeholder={list.status === 'loading' ? strings.calendarsLoadingShort : strings.chooseCalendar}
                isDisabled={writableOptions.length === 0}
                onChange={(id) => {
                  const picked = allCalendars.find((calendar) => calendar.id === id);
                  if (picked !== undefined && picked.id !== destination?.id) actions.onMakeDefault(picked);
                }}
              />
            </SettingsRow>
          </Card>
        </SettingsSection>
      </>
    );
  }

  const chosenId = step?.kind === 'choose' ? step.connectionId : undefined;
  const chosenAccount = connections.find((connection) => connection.id === chosenId);
  return (
    <SettingsPage title={strings.title} isLoading={state.status === 'loading'}>
      {body}
      {/* Off while calendar sync isn't set up here, where it could do nothing. */}
      {settings.status === 'ready' && settings.canManage && state.status === 'ready' && state.enabled && (
        <SettingsSection title={strings.workspaceSection}>
          <Card>
            <SettingsRow
              title={strings.createPeople}
              meta={<InfoTip label={strings.createPeople}>{strings.createPeopleExample}</InfoTip>}
            >
              <Switch
                label={strings.createPeople}
                isLabelHidden
                isSelected={settings.createUnknownPeople}
                onChange={(isSelected) => void data.calendar.setCreateUnknownPeople(slug, isSelected)}
              />
            </SettingsRow>
          </Card>
        </SettingsSection>
      )}
      <ConnectCalendarDialog
        step={step}
        providers={providers}
        onPick={(provider) => goConnect(provider)}
        account={chosenAccount}
        calendars={chosenId === undefined ? [] : calendarsOf(chosenId)}
        onCheck={(calendar, isOn) => void data.calendar.updateCalendar(slug, calendar.id, { checkConflicts: isOn })}
        onRetryCalendars={retryCalendars}
        onTryAgain={openConnect}
        onClose={() => {
          if (step?.kind === 'choose') toasts.toast({ tone: 'success', message: strings.connected });
          setStep(undefined);
        }}
      />
      <Modal
        title={strings.disconnectTitle(lastDisconnecting?.accountEmail ?? '')}
        variant="confirm"
        tone="danger"
        isOpen={disconnecting !== undefined}
        isBusy={isDisconnectBusy}
        onOpenChange={(isOpen) => {
          if (!isOpen && !isDisconnectBusy) setDisconnecting(undefined);
        }}
        actions={
          <>
            <Button slot="close" isDisabled={isDisconnectBusy}>
              {strings.cancel}
            </Button>
            <Button variant="danger-solid" isPending={isDisconnectBusy} onPress={disconnect}>
              {isDisconnectBusy ? strings.disconnecting : strings.disconnect}
            </Button>
          </>
        }
      >
        {disconnectFailure !== undefined && <Callout tone="danger">{disconnectFailure}</Callout>}
        {strings.disconnectText}
      </Modal>
    </SettingsPage>
  );
}
