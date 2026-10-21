// Brief
// Purpose: Settings › Scheduling › Calendars: the member's own accounts (Google, Outlook) and every calendar in each, so their meetings reach the records they're with and their bookings land where they choose.
// Main task: connect an account; per calendar, check it for conflicts, show it on the week, sync its meetings, pick its colour and make it the default; disconnect an account.
// Leaves out: other members' calendars. Owners and admins also choose whether meetings add people.
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
import { useMemo, useRef, useState } from 'react';
import { strings, type ConnectResult } from './calendar-strings.ts';
import { SettingsPage } from './SettingsPage.tsx';

/**
 * The page while the accounts load. No calendar yet is the page most people first load, an empty state with no
 * card, so the loading state stands in its place (the loading shape flow holds them together).
 */
export function CalendarsLoading() {
  return <EmptyState icon="calendar" title={strings.loading} isLoading />;
}

/** Props for the Calendar screen: what its route loaded through the data layer. */
export interface CalendarScreenProps {
  readonly data: DataLayer;
  readonly slug: string;
  readonly view: CalendarView;
  /** What the browser came back from the provider with, once (`?calendar=`). */
  readonly result?: ConnectResult;
  /** Clears `?calendar=` once the person has read it. */
  readonly onResultSeen: () => void;
}

const number = new Intl.NumberFormat();

/** Each connection state's dot: green when it syncs, blue while it starts, orange when it needs a reconnect, red when it broke. */
const STATUS_HUE = {
  syncing: 'blue',
  connected: 'green',
  expired: 'orange',
  revoked: 'red',
  failed: 'red',
} as const satisfies Record<CalendarStatus, Hue>;

/** Who sees a calendar's meetings, each choice saying what others see. */
const SHARING = [
  { id: 'shared', label: strings.shared, icon: 'users', description: strings.sharingHelp.shared },
  { id: 'private', label: strings.private, icon: 'lock', description: strings.sharingHelp.private },
] as const;

/** A provider's mark and name. */
const PROVIDER = {
  google: { mark: 'google-calendar', name: strings.google },
  microsoft: { mark: 'outlook', name: strings.outlook },
} as const satisfies Record<CalendarProvider, { readonly mark: 'google-calendar' | 'outlook'; readonly name: string }>;

/** A calendar's three switches, in the order a row shows them. */
const SWITCHES = ['checkConflicts', 'showInWeek', 'sync'] as const;
type SwitchName = (typeof SWITCHES)[number];

/** What a calendar's row can change, each saved at once (the owner's save rule, 21 October 2026). */
interface CalendarActions {
  readonly onSwitch: (calendar: CalendarItem, name: SwitchName, isOn: boolean) => void;
  readonly onColour: (calendar: CalendarItem, hue: Hue) => void;
  readonly onMakeDefault: (calendar: CalendarItem) => void;
}

/**
 * One calendar of an account (spec 0024 milestone 5, AC-993): its colour (a swatch that opens the nine hues), its
 * name, Default on the one new bookings go to (with the page's one InfoTip on how that works across accounts), Make
 * default on another it can write, and its three switches with their names shown.
 */
function CalendarRow({ calendar, actions }: { readonly calendar: CalendarItem; readonly actions: CalendarActions }) {
  const label = { checkConflicts: strings.checkConflicts, showInWeek: strings.showInWeek, sync: strings.sync };
  const description =
    calendar.warning?.message ??
    (calendar.accessRole === 'owner' || calendar.accessRole === 'writer' ? undefined : strings.readOnly);
  return (
    <SettingsRow
      title={calendar.name}
      leading={
        <HuePicker
          label={strings.colour(calendar.name)}
          value={calendar.hue}
          isCompact
          onChange={(hue) => actions.onColour(calendar, hue)}
        />
      }
      {...(calendar.isDestination
        ? {
            meta: (
              <>
                <Badge text={strings.defaultBadge} />
                <InfoTip label={strings.defaultHelpLabel} example={strings.defaultHelpExample}>
                  {strings.defaultHelp}
                </InfoTip>
              </>
            ),
          }
        : {})}
      {...(description === undefined ? {} : { description })}
    >
      {!calendar.isDestination && calendar.canBeDestination && (
        <Button variant="ghost" onPress={() => actions.onMakeDefault(calendar)}>
          {strings.makeDefault}
        </Button>
      )}
      {SWITCHES.map((name) => (
        <Switch
          key={name}
          label={label[name]}
          labelContext={strings.switchOn(calendar.name)}
          isSelected={calendar[name]}
          onChange={(isOn) => actions.onSwitch(calendar, name, isOn)}
        />
      ))}
    </SettingsRow>
  );
}

/**
 * One connected account as a card (the owner, 21 October 2026: a card per account with its calendars, as Calendly
 * lists them): the account's row (the provider's mark, the address, its state and last sync, Reconnect once it
 * stopped, who sees its meetings, and a "···" menu with Disconnect, which asks first), then its calendars.
 */
function AccountCard({
  connection,
  calendars,
  actions,
  onSharing,
  onDisconnect,
  onReconnect,
  onRetryCalendars,
  onSyncNow,
}: {
  readonly connection: CalendarConnectionView;
  /** Its calendars once listed; `loading` or `error` while the list isn't there. */
  readonly calendars: readonly CalendarItem[] | 'loading' | 'error';
  readonly actions: CalendarActions;
  readonly onSharing: (sharing: 'shared' | 'private') => void;
  readonly onDisconnect: () => void;
  /** Connects the account again, offered once it stopped syncing (expired, revoked or failed); absent when connecting is off. */
  readonly onReconnect?: () => void;
  readonly onRetryCalendars: () => void;
  /** Local development only (no push notices reach a laptop). */
  readonly onSyncNow?: () => void;
}) {
  const problem =
    connection.lastError !== undefined && connection.status !== 'connected' ? connection.lastError.message : undefined;
  const menuLabel = strings.rowActions(connection.accountEmail);
  const canReconnect = onReconnect !== undefined && needsReconnect(connection);
  const provider = PROVIDER[connection.provider];
  return (
    <Card>
      <SettingsRow
        title={connection.accountEmail}
        leading={<ProviderMark provider={provider.mark} isLabelled />}
        description={
          <>
            <Badge text={strings.status[connection.status]} dot={STATUS_HUE[connection.status]} />
            {' · '}
            {connection.lastSyncedAt === undefined ? (
              strings.notSyncedYet
            ) : (
              <>
                {/* A no break space: "Synced" never ends a line on its own. */}
                {strings.synced}
                {' '}
                <RelativeTime value={connection.lastSyncedAt} />
              </>
            )}
            {problem !== undefined && <> · {problem}</>}
          </>
        }
      >
        {/* An account that stopped syncing shows its fix on the row, not behind the menu. */}
        {canReconnect && <Button onPress={onReconnect}>{strings.reconnect}</Button>}
        {/* Read with the choice: "Teammates see Full details" (the Select's own name says it to screen readers). */}
        <span aria-hidden="true">{strings.sharingLabel}</span>
        <InfoTip label={strings.sharingLabel}>{strings.sharingInfo}</InfoTip>
        <Select
          label={strings.sharingLabel}
          isLabelHidden
          items={SHARING}
          value={connection.sharing}
          onChange={(value) => onSharing(value === 'private' ? 'private' : 'shared')}
        />
        <MenuTrigger>
          <Button variant="ghost" icon="ellipsis" label={menuLabel} />
          <Menu
            label={menuLabel}
            onAction={(key) => {
              if (key === 'sync') onSyncNow?.();
              if (key === 'disconnect') onDisconnect();
            }}
          >
            {onSyncNow !== undefined && (
              <MenuItem id="sync" icon="refresh-cw">
                {strings.syncNow}
              </MenuItem>
            )}
            {onSyncNow !== undefined && <MenuSeparator />}
            <MenuItem id="disconnect" icon="unplug" isDanger>
              {strings.disconnect}
            </MenuItem>
          </Menu>
        </MenuTrigger>
      </SettingsRow>
      <SettingsRowGroup title={strings.calendarsGroup}>
        {calendars === 'loading' ? (
          <span role="status" aria-label={strings.calendarsLoading}>
            <Skeleton width="long" />
          </span>
        ) : calendars === 'error' ? (
          <Callout
            tone="danger"
            actions={
              <Button variant="ghost" onPress={onRetryCalendars}>
                {strings.tryAgain}
              </Button>
            }
          >
            {strings.calendarsFailed}
          </Callout>
        ) : calendars.length === 0 ? (
          <span>{strings.noCalendars}</span>
        ) : (
          calendars.map((calendar) => <CalendarRow key={calendar.id} calendar={calendar} actions={actions} />)
        )}
      </SettingsRowGroup>
    </Card>
  );
}

/**
 * Each calendar change, saved at once and said in a quiet toast with Undo (the owner's save rule, 21 October 2026).
 * A refusal is put back and said by the data layer; Undo is the same change the other way.
 */
function useCalendarActions(data: DataLayer, slug: string, toasts: Toasts, destination: CalendarItem | undefined) {
  return useMemo<CalendarActions>(() => {
    const change = (calendar: CalendarItem, next: CalendarChange, back: CalendarChange, message: string) => {
      void data.calendar.updateCalendar(slug, calendar.id, next).then((isDone) => {
        if (!isDone) return;
        toasts.toast({
          tone: 'success',
          message,
          action: { label: strings.undo, onAction: () => void data.calendar.updateCalendar(slug, calendar.id, back) },
        });
      });
    };
    return {
      onSwitch: (calendar, name, isOn) =>
        change(calendar, { [name]: isOn }, { [name]: !isOn }, strings.saved[name](calendar.name, isOn)),
      onColour: (calendar, hue) =>
        change(
          calendar,
          { colourOverride: hue },
          { colourOverride: calendar.colourOverride ?? null },
          strings.colourSaved(calendar.name),
        ),
      onMakeDefault: (calendar) => {
        const was = destination;
        void data.calendar.setDestination(slug, calendar.id).then((isDone) => {
          if (!isDone) return;
          toasts.toast({
            tone: 'success',
            message: strings.defaultSaved(calendar.name),
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
 * Settings › Scheduling › Calendars (spec 0024): a card per connected account with its calendars, the default
 * marked, live while shown, and Connect (Google, Outlook, or a menu of both).
 */
export function CalendarScreen({ data, slug, view, result, onResultSeen }: CalendarScreenProps) {
  const state = useCalendar(view);
  const list = useCalendarList(data.calendar.calendars(slug));
  const settings = useCalendarSettings(data.calendar.settings(slug));
  const { toasts } = useRouteContext({ from: '__root__' });
  const byAccount = calendarsByAccount(list);
  const allCalendars = [...byAccount.values()].flat();
  const destination = allCalendars.find((calendar) => calendar.isDestination);
  const actions = useCalendarActions(data, slug, toasts, destination);
  const [disconnecting, setDisconnecting] = useState<CalendarConnectionView | undefined>(undefined);
  const [isDisconnectBusy, setDisconnectBusy] = useState(false);
  // The last account the confirm was opened for: it stays named through the confirm's exit.
  const [lastDisconnecting, setLastDisconnecting] = useState<CalendarConnectionView | undefined>(undefined);
  if (disconnecting !== undefined && disconnecting !== lastDisconnecting) setLastDisconnecting(disconnecting);
  // Connect (in the bar, or the empty state's): where focus goes once an account is disconnected.
  const connectRef = useRef<HTMLButtonElement>(null);
  const [disconnectFailure, setDisconnectFailure] = useState<string | undefined>(undefined);
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
        // Its card went with it, and the Disconnect that opened the confirm: focus goes to Connect.
        focusLater(() => connectRef.current);
      },
      (error: unknown) => {
        // The confirm stays open with what went wrong, so the person can try again or cancel.
        setDisconnectBusy(false);
        setDisconnectFailure(isDataError(error) ? error.message : strings.disconnectFailed);
      },
    );
  };
  const outcome = result === undefined ? undefined : strings.results[result];
  // Connecting is the browser going to the API, which sends it on to the provider's consent screen and back here.
  const connect = (provider: CalendarProvider) => {
    window.location.assign(data.calendar.connectUrl(slug, 'settings', provider));
  };
  const providers = state.status === 'ready' && state.enabled ? state.providers : [];
  const isFull = state.status === 'ready' && state.connections.length >= state.max;
  const canConnect = providers.length > 0 && !isFull;
  // The header's Connect sits beside a list; an empty page offers it in its own empty state.
  const hasList = state.status === 'ready' && state.connections.length > 0;
  const fellBack = list.status === 'ready' ? list.fellBack : undefined;

  // One provider on: its own button. Both: one Connect calendar that opens a menu of the two.
  const [onlyProvider] = providers;
  const connectButton =
    !canConnect || onlyProvider === undefined ? undefined : providers.length === 1 ? (
      <Button ref={connectRef} provider={PROVIDER[onlyProvider].mark} onPress={() => connect(onlyProvider)}>
        {onlyProvider === 'google' ? strings.connectGoogle : strings.connectOutlook}
      </Button>
    ) : (
      <MenuTrigger>
        <Button ref={connectRef} icon="plus">
          {strings.connect}
        </Button>
        <Menu label={strings.connectMenu} onAction={(key) => connect(key === 'microsoft' ? 'microsoft' : 'google')}>
          {providers.map((provider) => (
            <MenuItem key={provider} id={provider} leading={<ProviderMark provider={PROVIDER[provider].mark} />}>
              {PROVIDER[provider].name}
            </MenuItem>
          ))}
        </Menu>
      </MenuTrigger>
    );

  let body;
  if (state.status === 'loading') {
    // The connections' section, busy, so the cards arrive in its column.
    body = <CalendarsLoading />;
  } else if (state.status === 'error') {
    body = (
      <EmptyState tone="error" title={strings.failedTitle} onRetry={() => view.reload()}>
        {state.message}
      </EmptyState>
    );
  } else if (!state.enabled && state.connections.length === 0) {
    body = (
      <EmptyState icon="calendar" title={strings.offTitle}>
        {strings.offText}
      </EmptyState>
    );
  } else if (state.connections.length === 0) {
    body = (
      <EmptyState icon="calendar" title={strings.emptyTitle} actions={connectButton}>
        {strings.emptyText}
      </EmptyState>
    );
  } else {
    const calendarsOf = (connectionId: string): readonly CalendarItem[] | 'loading' | 'error' =>
      list.status === 'ready' ? (byAccount.get(connectionId) ?? []) : list.status;
    body = (
      <SettingsSection title={strings.connectionsSection}>
        {isFull && <Callout tone="info">{strings.limitReached(number.format(state.max))}</Callout>}
        {state.connections.map((connection) => (
          <AccountCard
            key={connection.id}
            connection={connection}
            calendars={calendarsOf(connection.id)}
            actions={actions}
            onSharing={(sharing) => {
              const was = connection.sharing;
              void data.calendar.setSharing(slug, connection.id, sharing).then((isDone) => {
                if (!isDone) return;
                toasts.toast({
                  tone: 'success',
                  message: strings.sharingSaved(connection.accountEmail),
                  action: {
                    label: strings.undo,
                    onAction: () => void data.calendar.setSharing(slug, connection.id, was),
                  },
                });
              });
            }}
            // Reconnecting goes through the same consent and lands on the same account, so the limit doesn't stop it.
            {...(providers.includes(connection.provider) ? { onReconnect: () => connect(connection.provider) } : {})}
            onDisconnect={() => {
              setDisconnectFailure(undefined);
              setDisconnecting(connection);
            }}
            onRetryCalendars={() => data.calendar.calendars(slug).reload()}
            {...(import.meta.env.DEV ? { onSyncNow: () => void data.calendar.syncNow(slug, connection.id) } : {})}
          />
        ))}
      </SettingsSection>
    );
  }

  return (
    <SettingsPage
      title={strings.title}
      isLoading={state.status === 'loading'}
      {...(connectButton !== undefined && hasList ? { actions: connectButton } : {})}
    >
      {outcome !== undefined && (
        <Callout
          tone={outcome.tone}
          title={outcome.title}
          isAnnounced
          actions={
            <Button variant="ghost" onPress={onResultSeen}>
              {strings.dismiss}
            </Button>
          }
        >
          {outcome.text}
        </Callout>
      )}
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
      {body}
      {/* Off while calendar sync isn't set up here, where it could do nothing. */}
      {settings.status === 'ready' && settings.canManage && state.status === 'ready' && state.enabled && (
        <SettingsSection title={strings.workspaceSection}>
          <Card>
            <SettingsRow
              title={strings.createPeople}
              description={strings.createPeopleHelp}
              meta={
                <InfoTip label={strings.createPeople} example={strings.createPeopleExample}>
                  {strings.createPeopleInfo}
                </InfoTip>
              }
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
      <Modal
        title={strings.disconnectTitle(lastDisconnecting?.accountEmail ?? '')}
        tone="danger"
        isOpen={disconnecting !== undefined}
        isBusy={isDisconnectBusy}
        onOpenChange={(isOpen) => {
          if (!isOpen && !isDisconnectBusy) setDisconnecting(undefined);
        }}
        actions={
          <>
            <Button slot="close" isDisabled={isDisconnectBusy} kbd="ESC">
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
